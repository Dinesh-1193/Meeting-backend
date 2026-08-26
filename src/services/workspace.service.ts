import { z } from "zod";
import { supabaseAdmin } from "../lib/supabase";
import {
  mapChat,
  mapContact,
  mapRecording,
  mapRecordingSummary,
  derivePresenceStatus,
} from "../lib/mappers";
import { AppError } from "../middleware/error-handler";
import { getProfilesByIds } from "./auth.service";
import { reconcileProcessingRecordings } from "./recording.service";
import { roomLookupOrFilter } from "../lib/ids";
import type { ApiRecording, ChatMessage, Contact, Paginated, RecordingSummary } from "../types/api";
import type {
  ChatMessageRow,
  Profile,
  RecordingRow,
  RoomRow,
} from "../types/database";
export const sendChatSchema = z.object({
  body: z.string().trim().min(1, "Message cannot be empty").max(4000),
});

export async function listRoomRecordings(roomId: string): Promise<ApiRecording[]> {
  const { data: room } = await supabaseAdmin
    .from("rooms")
    .select("id")
    .or(roomLookupOrFilter(roomId))
    .maybeSingle();

  if (!room) throw new AppError("Room not found", 404);
  const id = (room as { id: string }).id;

  const { data, error } = await supabaseAdmin
    .from("recordings")
    .select("*")
    .eq("room_id", id)
    .order("created_at", { ascending: false });

  if (error) throw new AppError(error.message, 500);
  const rows = await reconcileProcessingRecordings((data ?? []) as RecordingRow[]);
  return rows.map(mapRecording);
}

export async function listAllRecordingsForUser(
  userId: string,
  opts?: { limit?: number; cursor?: string },
): Promise<Paginated<RecordingSummary>> {
  const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 100);

  // Recordings for rooms the user hosts
  const { data: rooms, error: rErr } = await supabaseAdmin
    .from("rooms")
    .select("id, name, host_id")
    .eq("host_id", userId);

  if (rErr) throw new AppError(rErr.message, 500);
  const roomList = (rooms ?? []) as Pick<RoomRow, "id" | "name" | "host_id">[];
  if (!roomList.length) return { items: [], nextCursor: null };

  const roomIds = roomList.map((r) => r.id);
  const roomMap = new Map(roomList.map((r) => [r.id, r]));

  let query = supabaseAdmin
    .from("recordings")
    .select("*")
    .in("room_id", roomIds)
    .order("created_at", { ascending: false })
    .limit(limit + 1);

  if (opts?.cursor) {
    query = query.lt("created_at", opts.cursor);
  }

  const { data, error } = await query;

  if (error) throw new AppError(error.message, 500);

  const profiles = await getProfilesByIds([userId]);
  const hostName = profiles.get(userId)?.name;

  const rows = await reconcileProcessingRecordings((data ?? []) as RecordingRow[]);
  const hasMore = rows.length > limit;
  const slice = hasMore ? rows.slice(0, limit) : rows;
  return {
    items: slice.map((row) =>
      mapRecordingSummary(
        row,
        roomMap.get(row.room_id)?.name ?? "Meeting",
        hostName,
      ),
    ),
    nextCursor: hasMore ? slice[slice.length - 1]?.created_at ?? null : null,
  };
}

export async function sendChat(
  roomId: string,
  userId: string,
  body: string,
): Promise<ChatMessage> {
  const { data: room, error: roomErr } = await supabaseAdmin
    .from("rooms")
    .select("id, host_id, settings, alternate_hosts")
    .or(roomLookupOrFilter(roomId))
    .maybeSingle();

  if (roomErr) throw new AppError(roomErr.message, 500);
  if (!room) throw new AppError("Room not found", 404);

  const roomRow = room as Pick<RoomRow, "id" | "host_id" | "settings" | "alternate_hosts">;
  const profiles = await getProfilesByIds([userId]);
  const profile = profiles.get(userId);
  const senderName = profile?.name ?? "Participant";
  const isHost = roomRow.host_id === userId;
  const isAlternate =
    Boolean(profile?.email) && (roomRow.alternate_hosts ?? []).includes(profile!.email);
  const chatAllowed = roomRow.settings?.allowChat !== false || isHost || isAlternate;
  if (!chatAllowed) {
    throw new AppError("Chat is disabled for this meeting", 403);
  }

  const { data, error } = await supabaseAdmin
    .from("chat_messages")
    .insert({
      room_id: roomRow.id,
      sender_id: userId,
      sender_name: senderName,
      body,
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new AppError(error?.message ?? "Could not send message", 500);
  }
  return mapChat(data as ChatMessageRow);
}

export async function listChat(roomId: string): Promise<ChatMessage[]> {
  const { data: room, error: roomErr } = await supabaseAdmin
    .from("rooms")
    .select("id")
    .or(roomLookupOrFilter(roomId))
    .maybeSingle();

  if (roomErr) throw new AppError(roomErr.message, 500);
  if (!room) throw new AppError("Room not found", 404);

  const { data, error } = await supabaseAdmin
    .from("chat_messages")
    .select("*")
    .eq("room_id", (room as { id: string }).id)
    .order("created_at", { ascending: true })
    .limit(500);

  if (error) throw new AppError(error.message, 500);
  return ((data ?? []) as ChatMessageRow[]).map(mapChat);
}

export async function listContacts(
  userId: string,
  opts?: { limit?: number; cursor?: string },
): Promise<Paginated<Contact>> {
  const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 200);

  const { data: me, error: meErr } = await supabaseAdmin
    .from("profiles")
    .select("email")
    .eq("id", userId)
    .single();

  if (meErr || !me) throw new AppError(meErr?.message ?? "User not found", 404);

  const domain = (me as { email: string }).email.split("@")[1]?.toLowerCase();
  const ids = new Set<string>();

  if (domain) {
    const { data: domainRows, error: domainErr } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .neq("id", userId)
      .ilike("email", `%@${domain}`)
      .limit(200);

    if (domainErr) throw new AppError(domainErr.message, 500);
    for (const row of (domainRows ?? []) as { id: string }[]) ids.add(row.id);
  }

  const { data: links, error: linksErr } = await supabaseAdmin
    .from("contacts")
    .select("contact_user_id")
    .eq("owner_id", userId);

  if (linksErr) throw new AppError(linksErr.message, 500);
  for (const row of (links ?? []) as { contact_user_id: string }[]) {
    ids.add(row.contact_user_id);
  }

  if (!ids.size) return { items: [], nextCursor: null };

  let query = supabaseAdmin
    .from("profiles")
    .select("*")
    .in("id", [...ids])
    .order("name", { ascending: true })
    .limit(limit + 1);

  if (opts?.cursor) {
    query = query.gt("name", opts.cursor);
  }

  const { data: profiles, error: pErr } = await query;
  if (pErr) throw new AppError(pErr.message, 500);

  const profileList = (profiles ?? []) as Profile[];
  const hasMore = profileList.length > limit;
  const slice = hasMore ? profileList.slice(0, limit) : profileList;

  const inMeetingIds = await loadInMeetingUserIds(slice.map((p) => p.id));
  return {
    items: slice.map((p) => mapContact(p, derivePresenceStatus(p, inMeetingIds))),
    nextCursor: hasMore ? slice[slice.length - 1]?.name ?? null : null,
  };
}

async function loadInMeetingUserIds(userIds: string[]): Promise<Set<string>> {
  const set = new Set<string>();
  if (!userIds.length) return set;
  const { data } = await supabaseAdmin
    .from("room_participants")
    .select("user_id")
    .in("user_id", userIds)
    .eq("status", "joined")
    .is("left_at", null);
  for (const row of (data ?? []) as { user_id: string }[]) {
    set.add(row.user_id);
  }
  return set;
}

export async function addContact(ownerId: string, contactEmail: string) {
  const email = contactEmail.trim().toLowerCase();
  const { data: profile, error } = await supabaseAdmin
    .from("profiles")
    .select("*")
    .eq("email", email)
    .maybeSingle();

  if (error) throw new AppError(error.message, 500);
  if (!profile) throw new AppError("User not found", 404);
  if ((profile as Profile).id === ownerId) {
    throw new AppError("You cannot add yourself as a contact", 400);
  }

  const { error: insErr } = await supabaseAdmin.from("contacts").upsert(
    {
      owner_id: ownerId,
      contact_user_id: (profile as Profile).id,
    },
    { onConflict: "owner_id,contact_user_id" },
  );

  if (insErr) throw new AppError(insErr.message, 500);

  const inMeetingIds = await loadInMeetingUserIds([(profile as Profile).id]);
  return mapContact(
    profile as Profile,
    derivePresenceStatus(profile as Profile, inMeetingIds),
  );
}