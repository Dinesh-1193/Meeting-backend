import { supabaseAdmin } from "../lib/supabase";
import { AppError } from "../middleware/error-handler";
import { getProfilesByIds } from "./auth.service";
import { chatChannelName, publishToChannel } from "../lib/centrifugo";
import { uploadChatAttachment } from "../lib/r2-upload";
import type {
  ApiChatChannel,
  ApiChatConversation,
  ApiChatMessage,
  ApiChatMessageAttachment,
  ApiChatMessagePage,
  ApiChatMessageReaction,
  ApiChatMessageReplyTo,
} from "../types/api";
import type {
  ChatChannelMemberRow,
  ChatChannelMessageRow,
  ChatChannelRow,
  ChatMessageAttachmentRow,
  ChatMessageReactionRow,
} from "../types/database";

function mapChannel(row: ChatChannelRow): ApiChatChannel {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMessage(
  row: ChatChannelMessageRow,
  extras?: {
    replyTo?: ApiChatMessageReplyTo | null;
    reactions?: ApiChatMessageReaction[];
    attachments?: ApiChatMessageAttachment[];
  },
): ApiChatMessage {
  const deleted = Boolean(row.deleted_at);
  return {
    id: row.id,
    seq: String(row.seq),
    channelId: row.channel_id,
    senderId: row.sender_id,
    senderName: row.sender_name,
    body: deleted ? "" : row.body,
    createdAt: row.created_at,
    editedAt: row.edited_at,
    deletedAt: row.deleted_at,
    replyTo: deleted ? null : (extras?.replyTo ?? null),
    forwardedFromSenderName: deleted ? null : row.forwarded_from_sender_name,
    reactions: deleted ? [] : (extras?.reactions ?? []),
    attachments: deleted ? [] : (extras?.attachments ?? []),
  };
}

/** Batch-resolves reactions/attachments/reply-snippets for a page of messages. */
async function attachMessageExtras(rows: ChatChannelMessageRow[]): Promise<ApiChatMessage[]> {
  if (!rows.length) return [];
  const messageIds = rows.map((r) => r.id);

  const [reactionRes, attachmentRes] = await Promise.all([
    supabaseAdmin.from("chat_message_reactions").select("*").in("message_id", messageIds),
    supabaseAdmin.from("chat_message_attachments").select("*").in("message_id", messageIds),
  ]);
  if (reactionRes.error) throw new AppError(reactionRes.error.message, 500);
  if (attachmentRes.error) throw new AppError(attachmentRes.error.message, 500);

  const reactionsByMessage = new Map<string, Map<string, string[]>>();
  for (const r of (reactionRes.data ?? []) as ChatMessageReactionRow[]) {
    let byEmoji = reactionsByMessage.get(r.message_id);
    if (!byEmoji) {
      byEmoji = new Map();
      reactionsByMessage.set(r.message_id, byEmoji);
    }
    const users = byEmoji.get(r.emoji) ?? [];
    users.push(r.user_id);
    byEmoji.set(r.emoji, users);
  }

  const attachmentsByMessage = new Map<string, ApiChatMessageAttachment[]>();
  for (const a of (attachmentRes.data ?? []) as ChatMessageAttachmentRow[]) {
    const list = attachmentsByMessage.get(a.message_id) ?? [];
    list.push({
      id: a.id,
      filename: a.filename,
      contentType: a.content_type,
      sizeBytes: a.size_bytes,
      url: a.url,
    });
    attachmentsByMessage.set(a.message_id, list);
  }

  const replyToIds = [
    ...new Set(rows.map((r) => r.reply_to_message_id).filter((id): id is string => Boolean(id))),
  ];
  const replyToById = new Map<string, ApiChatMessageReplyTo>();
  if (replyToIds.length) {
    const { data: replyRows, error: replyErr } = await supabaseAdmin
      .from("chat_channel_messages")
      .select("id, sender_id, sender_name, body")
      .in("id", replyToIds);
    if (replyErr) throw new AppError(replyErr.message, 500);
    for (const r of (replyRows ?? []) as Pick<
      ChatChannelMessageRow,
      "id" | "sender_id" | "sender_name" | "body"
    >[]) {
      replyToById.set(r.id, { id: r.id, senderId: r.sender_id, senderName: r.sender_name, body: r.body });
    }
  }

  return rows.map((row) => {
    const byEmoji = reactionsByMessage.get(row.id);
    const reactions: ApiChatMessageReaction[] = byEmoji
      ? [...byEmoji.entries()].map(([emoji, userIds]) => ({ emoji, userIds }))
      : [];
    return mapMessage(row, {
      replyTo: row.reply_to_message_id ? (replyToById.get(row.reply_to_message_id) ?? null) : null,
      reactions,
      attachments: attachmentsByMessage.get(row.id) ?? [],
    });
  });
}

/** The real access-control boundary for chat — every other function here calls this first. */
export async function assertChannelMember(channelId: string, userId: string): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from("chat_channel_members")
    .select("id")
    .eq("channel_id", channelId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new AppError(error.message, 500);
  if (!data) throw new AppError("Not a member of this channel", 403);
}

async function getMessageInChannel(channelId: string, messageId: string): Promise<ChatChannelMessageRow> {
  const { data, error } = await supabaseAdmin
    .from("chat_channel_messages")
    .select("*")
    .eq("id", messageId)
    .eq("channel_id", channelId)
    .maybeSingle();
  if (error) throw new AppError(error.message, 500);
  if (!data) throw new AppError("Message not found", 404);
  return data as ChatChannelMessageRow;
}

export async function listConversations(userId: string): Promise<ApiChatConversation[]> {
  const { data: memberRows, error: memberErr } = await supabaseAdmin
    .from("chat_channel_members")
    .select("*")
    .eq("user_id", userId);
  if (memberErr) throw new AppError(memberErr.message, 500);
  const myMemberships = (memberRows ?? []) as ChatChannelMemberRow[];
  if (!myMemberships.length) return [];

  const channelIds = myMemberships.map((m) => m.channel_id);
  const { data: channelRows, error: chErr } = await supabaseAdmin
    .from("chat_channels")
    .select("*")
    .in("id", channelIds)
    .order("updated_at", { ascending: false });
  if (chErr) throw new AppError(chErr.message, 500);
  const channels = (channelRows ?? []) as ChatChannelRow[];

  const { data: allMemberRows, error: allMemErr } = await supabaseAdmin
    .from("chat_channel_members")
    .select("*")
    .in("channel_id", channelIds);
  if (allMemErr) throw new AppError(allMemErr.message, 500);
  const allMembers = (allMemberRows ?? []) as ChatChannelMemberRow[];

  const membersByChannel = new Map<string, ChatChannelMemberRow[]>();
  for (const m of allMembers) {
    const list = membersByChannel.get(m.channel_id) ?? [];
    list.push(m);
    membersByChannel.set(m.channel_id, list);
  }

  const otherUserIds = new Set<string>();
  for (const m of allMembers) {
    if (m.user_id !== userId) otherUserIds.add(m.user_id);
  }
  const profiles = await getProfilesByIds([...otherUserIds]);

  const myMemberByChannel = new Map(myMemberships.map((m) => [m.channel_id, m]));

  // `seq` is a single monotonic counter shared across ALL channels (needed
  // for clean cursor pagination), so it is NOT safe to derive a per-channel
  // unread count via `last_message_seq - last_read_seq` — messages from
  // other channels advance the shared counter too. Count for real instead.
  const unreadCountEntries = await Promise.all(
    channels.map(async (ch): Promise<readonly [string, number]> => {
      const lastReadSeq = myMemberByChannel.get(ch.id)?.last_read_seq ?? 0;
      if (ch.last_message_seq <= lastReadSeq) return [ch.id, 0] as const;
      const { count, error } = await supabaseAdmin
        .from("chat_channel_messages")
        .select("id", { count: "exact", head: true })
        .eq("channel_id", ch.id)
        .is("deleted_at", null)
        .gt("seq", lastReadSeq);
      if (error) throw new AppError(error.message, 500);
      return [ch.id, count ?? 0] as const;
    }),
  );
  const unreadCountByChannel = new Map(unreadCountEntries);

  const conversations = channels.map((ch) => {
    const members = membersByChannel.get(ch.id) ?? [];
    const others = members.filter((m) => m.user_id !== userId);
    const unreadCount = unreadCountByChannel.get(ch.id) ?? 0;
    const myMembership = myMemberByChannel.get(ch.id);

    let displayName: string;
    let otherParticipant: ApiChatConversation["otherParticipant"];
    if (ch.type === "dm") {
      const other = others[0];
      const profile = other ? profiles.get(other.user_id) : undefined;
      displayName = profile?.name ?? "Unknown";
      otherParticipant = other
        ? { id: other.user_id, name: profile?.name ?? "Unknown", avatarUrl: profile?.avatar_url }
        : undefined;
    } else {
      const names = others
        .map((m) => profiles.get(m.user_id)?.name)
        .filter((n): n is string => Boolean(n))
        .slice(0, 3);
      displayName = ch.name ?? (names.length ? names.join(", ") : "Group chat");
    }

    return {
      ...mapChannel(ch),
      displayName,
      otherParticipant,
      memberCount: members.length,
      lastMessagePreview: ch.last_message_preview,
      lastMessageSenderId: ch.last_message_sender_id,
      lastMessageCreatedAt: ch.last_message_created_at,
      unreadCount,
      muted: myMembership?.muted ?? false,
      pinnedAt: myMembership?.pinned_at ?? null,
    };
  });

  // Pinned conversations float to the top (most-recently-pinned first);
  // everything else keeps the updated_at-desc order from the query above —
  // Array.prototype.sort is stable, so ties fall through unchanged.
  return conversations.sort((a, b) => {
    if (a.pinnedAt && b.pinnedAt) return b.pinnedAt.localeCompare(a.pinnedAt);
    if (a.pinnedAt) return -1;
    if (b.pinnedAt) return 1;
    return 0;
  });
}

export async function getOrCreateDirectChannel(
  userId: string,
  otherUserId: string,
): Promise<ApiChatChannel> {
  if (userId === otherUserId) {
    throw new AppError("Cannot start a DM with yourself", 400);
  }
  const dmKey = [userId, otherUserId].sort().join(":");

  const { data: existing, error: findErr } = await supabaseAdmin
    .from("chat_channels")
    .select("*")
    .eq("dm_key", dmKey)
    .maybeSingle();
  if (findErr) throw new AppError(findErr.message, 500);

  let channel: ChatChannelRow;
  if (existing) {
    channel = existing as ChatChannelRow;
  } else {
    const { data: created, error: insertErr } = await supabaseAdmin
      .from("chat_channels")
      .insert({ type: "dm", dm_key: dmKey, created_by: userId })
      .select("*")
      .single();

    if (insertErr) {
      // Unique violation — another request created the same DM concurrently; fetch it.
      if (insertErr.code === "23505") {
        const { data: retryFound, error: retryErr } = await supabaseAdmin
          .from("chat_channels")
          .select("*")
          .eq("dm_key", dmKey)
          .single();
        if (retryErr || !retryFound) {
          throw new AppError(retryErr?.message ?? "Could not create direct message", 500);
        }
        channel = retryFound as ChatChannelRow;
      } else {
        throw new AppError(insertErr.message, 500);
      }
    } else {
      channel = created as ChatChannelRow;
    }
  }

  const { error: memErr } = await supabaseAdmin.from("chat_channel_members").upsert(
    [
      { channel_id: channel.id, user_id: userId },
      { channel_id: channel.id, user_id: otherUserId },
    ],
    { onConflict: "channel_id,user_id", ignoreDuplicates: true },
  );
  if (memErr) throw new AppError(memErr.message, 500);

  return mapChannel(channel);
}

export async function createGroupChannel(
  userId: string,
  name: string | null,
  memberUserIds: string[],
): Promise<ApiChatChannel> {
  const uniqueMembers = [...new Set(memberUserIds.filter((id) => id !== userId))];
  if (!uniqueMembers.length) {
    throw new AppError("A group needs at least one other member", 400);
  }

  const { data, error } = await supabaseAdmin
    .from("chat_channels")
    .insert({ type: "group", name, created_by: userId })
    .select("*")
    .single();
  if (error || !data) {
    throw new AppError(error?.message ?? "Could not create group", 500);
  }
  const channel = data as ChatChannelRow;

  const rows = [userId, ...uniqueMembers].map((id) => ({ channel_id: channel.id, user_id: id }));
  const { error: memErr } = await supabaseAdmin.from("chat_channel_members").insert(rows);
  if (memErr) throw new AppError(memErr.message, 500);

  return mapChannel(channel);
}

export async function listChannelMessages(
  userId: string,
  channelId: string,
  opts: { cursor?: string; limit?: number },
): Promise<ApiChatMessagePage> {
  await assertChannelMember(channelId, userId);
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);

  let query = supabaseAdmin
    .from("chat_channel_messages")
    .select("*")
    .eq("channel_id", channelId)
    .order("seq", { ascending: false })
    .limit(limit + 1);

  if (opts.cursor) {
    const cursorSeq = Number(opts.cursor);
    if (!Number.isFinite(cursorSeq)) throw new AppError("Invalid cursor", 400);
    query = query.lt("seq", cursorSeq);
  }

  const { data, error } = await query;
  if (error) throw new AppError(error.message, 500);
  const rows = (data ?? []) as ChatChannelMessageRow[];

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? String(page[page.length - 1].seq) : null;

  const mapped = await attachMessageExtras(page.slice().reverse());
  return { messages: mapped, nextCursor };
}

/** Shared tail of every message-send path: denormalize, mark sender read, publish. */
async function finalizeSentMessage(
  userId: string,
  channelId: string,
  message: ChatChannelMessageRow,
  previewOverride?: string,
): Promise<ApiChatMessage> {
  const preview =
    previewOverride ?? (message.body.length > 200 ? `${message.body.slice(0, 200)}…` : message.body);
  await supabaseAdmin
    .from("chat_channels")
    .update({
      last_message_seq: message.seq,
      last_message_preview: preview,
      last_message_sender_id: userId,
      last_message_created_at: message.created_at,
      updated_at: new Date().toISOString(),
    })
    .eq("id", channelId);

  // Sending implicitly marks the channel as read for the sender.
  await supabaseAdmin
    .from("chat_channel_members")
    .update({ last_read_seq: message.seq })
    .eq("channel_id", channelId)
    .eq("user_id", userId);

  const [mapped] = await attachMessageExtras([message]);
  // Publish last, after every DB write commits, so subscribers never see a
  // real-time event for a message that isn't yet fetchable via REST.
  await publishToChannel(chatChannelName(channelId), { type: "message", message: mapped });

  return mapped;
}

export async function sendMessage(
  userId: string,
  channelId: string,
  body: string,
  opts: { replyToMessageId?: string; forwardedFromSenderName?: string } = {},
): Promise<ApiChatMessage> {
  await assertChannelMember(channelId, userId);
  if (opts.replyToMessageId) {
    await getMessageInChannel(channelId, opts.replyToMessageId);
  }

  const profiles = await getProfilesByIds([userId]);
  const senderName = profiles.get(userId)?.name ?? "Unknown";

  const { data, error } = await supabaseAdmin
    .from("chat_channel_messages")
    .insert({
      channel_id: channelId,
      sender_id: userId,
      sender_name: senderName,
      body,
      reply_to_message_id: opts.replyToMessageId ?? null,
      forwarded_from_sender_name: opts.forwardedFromSenderName ?? null,
    })
    .select("*")
    .single();
  if (error || !data) {
    throw new AppError(error?.message ?? "Could not send message", 500);
  }

  return finalizeSentMessage(userId, channelId, data as ChatChannelMessageRow);
}

export async function addAttachment(
  userId: string,
  channelId: string,
  file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
  caption?: string,
  replyToMessageId?: string,
): Promise<ApiChatMessage> {
  await assertChannelMember(channelId, userId);
  if (replyToMessageId) {
    await getMessageInChannel(channelId, replyToMessageId);
  }

  // Upload first so we never leave an orphan message row if R2 fails.
  const url = await uploadChatAttachment(file.buffer, file.originalname, file.mimetype);

  const profiles = await getProfilesByIds([userId]);
  const senderName = profiles.get(userId)?.name ?? "Unknown";
  const body = caption?.trim() ?? "";

  const { data, error } = await supabaseAdmin
    .from("chat_channel_messages")
    .insert({
      channel_id: channelId,
      sender_id: userId,
      sender_name: senderName,
      body,
      reply_to_message_id: replyToMessageId ?? null,
    })
    .select("*")
    .single();
  if (error || !data) {
    throw new AppError(error?.message ?? "Could not send attachment", 500);
  }
  const message = data as ChatChannelMessageRow;

  const { error: attachErr } = await supabaseAdmin.from("chat_message_attachments").insert({
    message_id: message.id,
    filename: file.originalname,
    content_type: file.mimetype,
    size_bytes: file.size,
    url,
  });
  if (attachErr) {
    await supabaseAdmin.from("chat_channel_messages").delete().eq("id", message.id);
    throw new AppError(attachErr.message, 500);
  }

  return finalizeSentMessage(userId, channelId, message, body || `📎 ${file.originalname}`);
}

export async function editMessage(
  userId: string,
  channelId: string,
  messageId: string,
  body: string,
): Promise<ApiChatMessage> {
  await assertChannelMember(channelId, userId);
  const existing = await getMessageInChannel(channelId, messageId);
  if (existing.sender_id !== userId) {
    throw new AppError("Only the sender can edit this message", 403);
  }
  if (existing.deleted_at) {
    throw new AppError("Cannot edit a deleted message", 400);
  }

  const { data, error } = await supabaseAdmin
    .from("chat_channel_messages")
    .update({ body, edited_at: new Date().toISOString() })
    .eq("id", messageId)
    .select("*")
    .single();
  if (error || !data) throw new AppError(error?.message ?? "Could not edit message", 500);
  const updated = data as ChatChannelMessageRow;

  const { data: channelRow } = await supabaseAdmin
    .from("chat_channels")
    .select("last_message_seq")
    .eq("id", channelId)
    .single();
  if ((channelRow as Pick<ChatChannelRow, "last_message_seq"> | null)?.last_message_seq === updated.seq) {
    const preview = body.length > 200 ? `${body.slice(0, 200)}…` : body;
    await supabaseAdmin
      .from("chat_channels")
      .update({ last_message_preview: preview })
      .eq("id", channelId);
  }

  const [mapped] = await attachMessageExtras([updated]);
  await publishToChannel(chatChannelName(channelId), { type: "edit", message: mapped });
  return mapped;
}

export async function toggleReaction(
  userId: string,
  channelId: string,
  messageId: string,
  emoji: string,
): Promise<ApiChatMessageReaction[]> {
  await assertChannelMember(channelId, userId);
  await getMessageInChannel(channelId, messageId);

  const { data: existing, error: findErr } = await supabaseAdmin
    .from("chat_message_reactions")
    .select("id")
    .eq("message_id", messageId)
    .eq("user_id", userId)
    .eq("emoji", emoji)
    .maybeSingle();
  if (findErr) throw new AppError(findErr.message, 500);

  if (existing) {
    const { error } = await supabaseAdmin.from("chat_message_reactions").delete().eq("id", existing.id);
    if (error) throw new AppError(error.message, 500);
  } else {
    const { error } = await supabaseAdmin
      .from("chat_message_reactions")
      .insert({ message_id: messageId, user_id: userId, emoji });
    if (error) throw new AppError(error.message, 500);
  }

  const { data: rows, error: listErr } = await supabaseAdmin
    .from("chat_message_reactions")
    .select("*")
    .eq("message_id", messageId);
  if (listErr) throw new AppError(listErr.message, 500);

  const byEmoji = new Map<string, string[]>();
  for (const r of (rows ?? []) as ChatMessageReactionRow[]) {
    const users = byEmoji.get(r.emoji) ?? [];
    users.push(r.user_id);
    byEmoji.set(r.emoji, users);
  }
  const reactions = [...byEmoji.entries()].map(([reactionEmoji, userIds]) => ({
    emoji: reactionEmoji,
    userIds,
  }));

  await publishToChannel(chatChannelName(channelId), {
    type: "reaction",
    channelId,
    messageId,
    reactions,
  });
  return reactions;
}

export async function setMuted(userId: string, channelId: string, muted: boolean): Promise<void> {
  await assertChannelMember(channelId, userId);
  const { error } = await supabaseAdmin
    .from("chat_channel_members")
    .update({ muted })
    .eq("channel_id", channelId)
    .eq("user_id", userId);
  if (error) throw new AppError(error.message, 500);
}

export async function setPinned(userId: string, channelId: string, pinned: boolean): Promise<void> {
  await assertChannelMember(channelId, userId);
  const { error } = await supabaseAdmin
    .from("chat_channel_members")
    .update({ pinned_at: pinned ? new Date().toISOString() : null })
    .eq("channel_id", channelId)
    .eq("user_id", userId);
  if (error) throw new AppError(error.message, 500);
}

export async function leaveChannel(userId: string, channelId: string): Promise<void> {
  await assertChannelMember(channelId, userId);
  const { error } = await supabaseAdmin
    .from("chat_channel_members")
    .delete()
    .eq("channel_id", channelId)
    .eq("user_id", userId);
  if (error) throw new AppError(error.message, 500);
}

export async function markChannelRead(userId: string, channelId: string): Promise<void> {
  await assertChannelMember(channelId, userId);

  const { data: channel, error: chErr } = await supabaseAdmin
    .from("chat_channels")
    .select("last_message_seq")
    .eq("id", channelId)
    .single();
  if (chErr || !channel) throw new AppError(chErr?.message ?? "Channel not found", 404);

  const { error } = await supabaseAdmin
    .from("chat_channel_members")
    .update({ last_read_seq: (channel as ChatChannelRow).last_message_seq })
    .eq("channel_id", channelId)
    .eq("user_id", userId);
  if (error) throw new AppError(error.message, 500);
}

export async function deleteMessage(
  userId: string,
  channelId: string,
  messageId: string,
): Promise<ApiChatMessage> {
  await assertChannelMember(channelId, userId);
  const existing = await getMessageInChannel(channelId, messageId);
  if (existing.sender_id !== userId) {
    throw new AppError("Only the sender can delete this message", 403);
  }
  if (existing.deleted_at) {
    const [mapped] = await attachMessageExtras([existing]);
    return mapped;
  }

  const { data, error } = await supabaseAdmin
    .from("chat_channel_messages")
    .update({ deleted_at: new Date().toISOString(), body: "" })
    .eq("id", messageId)
    .select("*")
    .single();
  if (error || !data) throw new AppError(error?.message ?? "Could not delete message", 500);
  const updated = data as ChatChannelMessageRow;

  const { data: channelRow } = await supabaseAdmin
    .from("chat_channels")
    .select("last_message_seq")
    .eq("id", channelId)
    .single();
  if ((channelRow as Pick<ChatChannelRow, "last_message_seq"> | null)?.last_message_seq === updated.seq) {
    await supabaseAdmin
      .from("chat_channels")
      .update({ last_message_preview: "Message deleted" })
      .eq("id", channelId);
  }

  const [mapped] = await attachMessageExtras([updated]);
  await publishToChannel(chatChannelName(channelId), { type: "delete", message: mapped });
  return mapped;
}

export async function searchChannelMessages(
  userId: string,
  channelId: string,
  q: string,
  limit = 30,
): Promise<ApiChatMessage[]> {
  await assertChannelMember(channelId, userId);
  const term = q.trim();
  if (!term) return [];

  const { data, error } = await supabaseAdmin
    .from("chat_channel_messages")
    .select("*")
    .eq("channel_id", channelId)
    .is("deleted_at", null)
    .ilike("body", `%${term}%`)
    .order("seq", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 50));
  if (error) throw new AppError(error.message, 500);
  return attachMessageExtras(((data ?? []) as ChatChannelMessageRow[]).slice().reverse());
}

export async function publishTyping(
  userId: string,
  channelId: string,
): Promise<void> {
  await assertChannelMember(channelId, userId);
  const profiles = await getProfilesByIds([userId]);
  const name = profiles.get(userId)?.name ?? "Someone";
  await publishToChannel(chatChannelName(channelId), {
    type: "typing",
    channelId,
    userId,
    name,
  });
}

export async function renameChannel(
  userId: string,
  channelId: string,
  name: string,
): Promise<ApiChatChannel> {
  await assertChannelMember(channelId, userId);
  const { data: channel, error: chErr } = await supabaseAdmin
    .from("chat_channels")
    .select("*")
    .eq("id", channelId)
    .maybeSingle();
  if (chErr) throw new AppError(chErr.message, 500);
  if (!channel) throw new AppError("Channel not found", 404);
  const row = channel as ChatChannelRow;
  if (row.type !== "group") throw new AppError("Only group chats can be renamed", 400);

  const trimmed = name.trim();
  if (!trimmed) throw new AppError("Name is required", 400);

  const { data, error } = await supabaseAdmin
    .from("chat_channels")
    .update({ name: trimmed, updated_at: new Date().toISOString() })
    .eq("id", channelId)
    .select("*")
    .single();
  if (error || !data) throw new AppError(error?.message ?? "Could not rename", 500);
  return mapChannel(data as ChatChannelRow);
}

export async function listChannelMembers(
  userId: string,
  channelId: string,
): Promise<{ id: string; name: string; avatarUrl?: string | null }[]> {
  await assertChannelMember(channelId, userId);
  const { data, error } = await supabaseAdmin
    .from("chat_channel_members")
    .select("user_id")
    .eq("channel_id", channelId);
  if (error) throw new AppError(error.message, 500);
  const ids = ((data ?? []) as { user_id: string }[]).map((r) => r.user_id);
  const profiles = await getProfilesByIds(ids);
  return ids.map((id) => {
    const p = profiles.get(id);
    return { id, name: p?.name ?? "Unknown", avatarUrl: p?.avatar_url };
  });
}

export async function getChatStorageStatus(): Promise<{ attachmentsEnabled: boolean; realtimeConfigured: boolean }> {
  const { r2Config } = await import("../config/env");
  const { isChatRealtimeConfigured } = await import("../lib/centrifugo");
  return {
    attachmentsEnabled: Boolean(r2Config),
    realtimeConfigured: isChatRealtimeConfigured(),
  };
}
