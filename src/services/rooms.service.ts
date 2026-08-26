import { randomUUID } from "crypto";
import { z } from "zod";
import { supabaseAdmin } from "../lib/supabase";
import { createLiveKitToken } from "../lib/livekit";
import { newRoomId, personalRoomId, formatJoinCode, meetingLobbyPath, buildMeetingJoinUrl, roomLookupOrFilter } from "../lib/ids";
import { mapRoom, mapMeeting } from "../lib/mappers";
import { AppError } from "../middleware/error-handler";
import { getProfilesByIds, assertGuestRoomAccess } from "./auth.service";
import { sendMeetingInvite } from "../lib/email";
import { notifyUsersByEmails } from "./notifications.service";
import { env } from "../config/env";
import type { ParticipantRole, RoomRow, RoomSettings } from "../types/database";
import type { ApiRoom, MeetingSummary, Paginated, RoomTokenResponse } from "../types/api";

const roomSettingsSchema = z
  .object({
    muteOnEntry: z.boolean().optional(),
    videoOffOnEntry: z.boolean().optional(),
    waitingRoom: z.boolean().optional(),
    allowChat: z.boolean().optional(),
    allowScreenShare: z.boolean().optional(),
    maxParticipants: z.number().int().positive().max(1000).optional(),
  })
  .optional();

export const createRoomSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  mode: z.enum(["conference", "webinar"]).optional().default("conference"),
  scheduledAt: z
    .string()
    .optional()
    .nullable()
    .transform((v, ctx) => {
      if (v == null || v === "") return null;
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Invalid scheduledAt",
        });
        return z.NEVER;
      }
      return d.toISOString();
    }),
  durationMinutes: z.coerce.number().int().positive().max(24 * 60).optional(),
  description: z.string().trim().max(2000).optional(),
  timezone: z.string().trim().max(100).optional(),
  invitedEmails: z.array(z.string().trim().email()).max(200).optional(),
  alternateHosts: z.array(z.string().trim().email()).max(50).optional(),
  recurrence: z.enum(["none", "daily", "weekly"]).optional().default("none"),
  settings: roomSettingsSchema,
  passcode: z.string().trim().max(20).nullable().optional(),
});

export const updateRoomSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).optional(),
  scheduledAt: z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (v == null) return undefined;
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid scheduledAt" });
        return z.NEVER;
      }
      return d.toISOString();
    }),
  durationMinutes: z.coerce.number().int().positive().max(24 * 60).optional(),
  invitedEmails: z.array(z.string().trim().email()).max(200).optional(),
  alternateHosts: z.array(z.string().trim().email()).max(50).optional(),
  settings: roomSettingsSchema,
  scope: z.enum(["this", "all"]).optional().default("this"),
  passcode: z.string().trim().max(20).nullable().optional(),
});

const RECURRENCE_OCCURRENCES = 8;

function nextOccurrence(date: Date, rule: "daily" | "weekly", index: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + (rule === "daily" ? index : index * 7));
  return d;
}

const defaultSettings: RoomSettings = {
  muteOnEntry: false,
  videoOffOnEntry: false,
  waitingRoom: false,
  allowChat: true,
  allowScreenShare: true,
  maxParticipants: 100,
};

export async function ensurePersonalRoom(
  userId: string,
  userName: string,
): Promise<RoomRow> {
  const id = personalRoomId(userId);
  const { data: existing } = await supabaseAdmin
    .from("rooms")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (existing) return existing as RoomRow;

  const { data, error } = await supabaseAdmin
    .from("rooms")
    .insert({
      id,
      name: `${userName}'s Personal Room`,
      host_id: userId,
      status: "waiting",
      join_code: id,
      settings: defaultSettings,
      is_personal: true,
      participant_count: 0,
    })
    .select("*")
    .single();

  if (error || !data) {
    // Race: another request created it
    const { data: again } = await supabaseAdmin
      .from("rooms")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (again) return again as RoomRow;
    throw new AppError(error?.message ?? "Could not create personal room", 500);
  }
  return data as RoomRow;
}

export async function createRoom(
  hostId: string,
  input: z.infer<typeof createRoomSchema>,
): Promise<ApiRoom | MeetingSummary> {
  const scheduledAt = input.scheduledAt || null;
  const status = scheduledAt ? "scheduled" : "waiting";
  const name = input.name?.trim() || "Instant meeting";
  const recurrence = input.recurrence ?? "none";

  const occurrenceCount = scheduledAt && recurrence !== "none" ? RECURRENCE_OCCURRENCES : 1;
  const recurrenceGroupId = occurrenceCount > 1 ? randomUUID() : null;
  const baseDate = scheduledAt ? new Date(scheduledAt) : null;

  const rows = Array.from({ length: occurrenceCount }, (_, i) => {
    const occurrenceAt =
      baseDate && recurrence !== "none"
        ? nextOccurrence(baseDate, recurrence, i).toISOString()
        : scheduledAt;
    const id = newRoomId();
    return {
      id,
      name,
      host_id: hostId,
      status,
      mode: input.mode ?? "conference",
      join_code: formatJoinCode(id),
      scheduled_at: occurrenceAt,
      duration_minutes: input.durationMinutes ?? (scheduledAt ? 30 : null),
      settings: { ...defaultSettings, ...(input.settings ?? {}) },
      is_personal: false,
      participant_count: 1,
      description: input.description ?? null,
      timezone: input.timezone ?? null,
      invited_emails: input.invitedEmails ?? [],
      alternate_hosts: input.alternateHosts ?? [],
      recurrence_rule: recurrence !== "none" ? recurrence : null,
      recurrence_group_id: recurrenceGroupId,
      passcode: input.passcode || null,
    };
  });

  const { data, error } = await supabaseAdmin.from("rooms").insert(rows).select("*");

  if (error || !data?.length) {
    throw new AppError(error?.message ?? "Could not create room", 500);
  }

  const room = data[0] as RoomRow;
  const profiles = await getProfilesByIds([hostId]);
  const hostName = profiles.get(hostId)?.name ?? "Host";

  await dispatchInvites({
    room,
    hostName,
    emails: input.invitedEmails ?? [],
  });

  // Frontend scheduleMeeting expects MeetingSummary shape when scheduling
  if (scheduledAt) {
    return mapMeeting(room, hostName);
  }
  return mapRoom(room, hostName);
}

async function dispatchInvites(input: {
  room: RoomRow;
  hostName: string;
  emails: string[];
  previousEmails?: string[];
}): Promise<void> {
  const prev = new Set((input.previousEmails ?? []).map((e) => e.toLowerCase()));
  const targets = [...new Set(input.emails.map((e) => e.trim().toLowerCase()).filter(Boolean))].filter(
    (e) => !prev.has(e),
  );
  if (!targets.length) return;

  const joinUrl = buildMeetingJoinUrl(env.APP_PUBLIC_URL, input.room.join_code || input.room.id);
  await Promise.all(
    targets.map((to) =>
      sendMeetingInvite({
        to,
        meetingName: input.room.name,
        hostName: input.hostName,
        scheduledAt: input.room.scheduled_at,
        joinUrl,
        passcode: input.room.passcode,
      }),
    ),
  );

  await notifyUsersByEmails(targets, {
    type: "meeting_invite",
    title: `Invite: ${input.room.name}`,
    body: `${input.hostName} invited you to a meeting`,
    href: meetingLobbyPath(input.room.join_code || input.room.id),
  });
}

export async function updateRoom(
  roomId: string,
  hostId: string,
  patch: z.infer<typeof updateRoomSchema>,
): Promise<ApiRoom> {
  const room = await fetchRoom(roomId);
  if (room.host_id !== hostId) {
    throw new AppError("Only the host can edit this meeting", 403);
  }
  if (room.status !== "scheduled") {
    throw new AppError("Only scheduled meetings can be edited", 400);
  }

  // scheduled_at is occurrence-specific — broadcasting one occurrence's new
  // date to the whole series would collapse every occurrence onto the same
  // timestamp, so a date change only ever applies to the edited occurrence.
  // Every other field can legitimately apply to the whole series.
  const seriesUpdate = {
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.description !== undefined ? { description: patch.description } : {}),
    ...(patch.durationMinutes !== undefined ? { duration_minutes: patch.durationMinutes } : {}),
    ...(patch.invitedEmails !== undefined ? { invited_emails: patch.invitedEmails } : {}),
    ...(patch.alternateHosts !== undefined ? { alternate_hosts: patch.alternateHosts } : {}),
    ...(patch.settings !== undefined
      ? { settings: { ...defaultSettings, ...room.settings, ...patch.settings } }
      : {}),
    ...(patch.passcode !== undefined ? { passcode: patch.passcode || null } : {}),
  };

  let updated: RoomRow;
  if (patch.scope === "all" && room.recurrence_group_id) {
    if (Object.keys(seriesUpdate).length) {
      const { error } = await supabaseAdmin
        .from("rooms")
        .update(seriesUpdate)
        .eq("recurrence_group_id", room.recurrence_group_id)
        .gte("scheduled_at", new Date().toISOString());
      if (error) throw new AppError(error.message, 500);
    }
    if (patch.scheduledAt !== undefined) {
      const { error } = await supabaseAdmin
        .from("rooms")
        .update({ scheduled_at: patch.scheduledAt })
        .eq("id", room.id);
      if (error) throw new AppError(error.message, 500);
    }
    updated = await fetchRoom(room.id);
  } else {
    const { data, error } = await supabaseAdmin
      .from("rooms")
      .update({
        ...seriesUpdate,
        ...(patch.scheduledAt !== undefined ? { scheduled_at: patch.scheduledAt } : {}),
      })
      .eq("id", room.id)
      .select("*")
      .single();
    if (error || !data) {
      throw new AppError(error?.message ?? "Could not update meeting", 500);
    }
    updated = data as RoomRow;
  }

  const profiles = await getProfilesByIds([hostId]);
  const hostName = profiles.get(hostId)?.name ?? "Host";

  if (patch.invitedEmails !== undefined) {
    await dispatchInvites({
      room: updated,
      hostName,
      emails: patch.invitedEmails,
      previousEmails: room.invited_emails ?? [],
    });
  }

  return mapRoom(updated, hostName);
}

export async function cancelRoom(
  roomId: string,
  hostId: string,
  scope: "this" | "all",
): Promise<void> {
  const room = await fetchRoom(roomId);
  if (room.host_id !== hostId) {
    throw new AppError("Only the host can cancel this meeting", 403);
  }

  const patch = { status: "ended" as const, cancelled_at: new Date().toISOString() };
  let query = supabaseAdmin.from("rooms").update(patch);
  if (scope === "all" && room.recurrence_group_id) {
    query = query
      .eq("recurrence_group_id", room.recurrence_group_id)
      .gte("scheduled_at", new Date().toISOString());
  } else {
    query = query.eq("id", room.id);
  }

  const { error } = await query;
  if (error) throw new AppError(error.message, 500);
}

export async function getRoomById(roomId: string, viewerId?: string): Promise<ApiRoom> {
  const room = await fetchRoom(roomId);
  const profiles = await getProfilesByIds([room.host_id, ...(viewerId ? [viewerId] : [])]);
  const mapped = mapRoom(room, profiles.get(room.host_id)?.name);
  const viewerEmail = viewerId ? profiles.get(viewerId)?.email : undefined;
  const isPrivileged =
    viewerId === room.host_id ||
    (Boolean(viewerEmail) && (room.alternate_hosts ?? []).includes(viewerEmail!));
  // The passcode is a join gate — only the host (or a pre-assigned alternate
  // host) may read the plaintext back. Everyone else just needs to know one
  // is required.
  if (mapped.passcode && !isPrivileged) {
    mapped.passcode = null;
    mapped.hasPasscode = true;
  }
  return mapped;
}

export async function fetchRoom(roomId: string): Promise<RoomRow> {
  const { data, error } = await supabaseAdmin
    .from("rooms")
    .select("*")
    .or(roomLookupOrFilter(roomId))
    .maybeSingle();

  if (error) throw new AppError(error.message, 500);
  if (!data) throw new AppError("Room not found", 404);
  return data as RoomRow;
}

async function getParticipantRow(roomId: string, userId: string) {
  const { data } = await supabaseAdmin
    .from("room_participants")
    .select("*")
    .eq("room_id", roomId)
    .eq("user_id", userId)
    .maybeSingle();
  return data as
    | { role: ParticipantRole; status: string }
    | null;
}

export async function issueRoomToken(
  roomId: string,
  userId: string,
  displayName?: string,
  passcode?: string,
  guest?: { isGuest?: boolean; guestRoomId?: string },
): Promise<RoomTokenResponse> {
  const room = await fetchRoom(roomId);
  assertGuestRoomAccess(guest?.isGuest, guest?.guestRoomId, room.id);
  if (room.status === "ended") {
    throw new AppError("This meeting has ended", 410);
  }

  const profiles = await getProfilesByIds([userId]);
  const profile = profiles.get(userId);
  const name = displayName?.trim() || profile?.name || "Guest";
  const isHost = !guest?.isGuest && room.host_id === userId;
  const isAlternateHost =
    !isHost &&
    !guest?.isGuest &&
    Boolean(profile?.email) &&
    (room.alternate_hosts ?? []).includes(profile!.email);
  const effectiveHost = isHost || isAlternateHost;

  const existing = await getParticipantRow(room.id, userId);

  let role: ParticipantRole;
  if (effectiveHost) {
    role = "host";
  } else if (existing?.role === "cohost" || existing?.role === "panelist") {
    role = existing.role;
  } else {
    role = room.mode === "webinar" ? "attendee" : "panelist";
  }

  if (!effectiveHost) {
    if (room.is_locked) {
      throw new AppError("This meeting is locked", 423);
    }
    if (room.passcode && room.passcode !== passcode) {
      throw new AppError("Incorrect meeting passcode", 401);
    }
    if (room.settings?.waitingRoom) {
      if (!existing || existing.status === "pending") {
        throw new AppError("Waiting for host approval", 423);
      }
      if (existing.status === "denied") {
        throw new AppError("The host denied your request to join", 403);
      }
    }
  }

  await supabaseAdmin.from("room_participants").upsert(
    {
      room_id: room.id,
      user_id: userId,
      display_name: name,
      role,
      status: "joined",
      joined_at: new Date().toISOString(),
    },
    { onConflict: "room_id,user_id" },
  );

  // Transition waiting/scheduled → live when someone joins with a token
  if (room.status === "waiting" || room.status === "scheduled") {
    await supabaseAdmin
      .from("rooms")
      .update({
        status: "live",
        started_at: room.started_at ?? new Date().toISOString(),
      })
      .eq("id", room.id);
  }

  const { token, serverUrl } = await createLiveKitToken({
    roomName: room.id,
    identity: userId,
    name,
    role,
    allowScreenShare: room.settings?.allowScreenShare,
    metadata: { isHost: effectiveHost },
  });

  return {
    token,
    serverUrl,
    roomId: room.id,
    identity: userId,
    isHost: effectiveHost,
    role,
    mode: room.mode,
    forceMuted: !effectiveHost && Boolean(room.settings?.muteOnEntry),
  };
}

export async function listUserMeetings(
  userId: string,
  opts?: { limit?: number; cursor?: string },
): Promise<Paginated<MeetingSummary> | MeetingSummary[]> {
  const limit = Math.min(Math.max(opts?.limit ?? 100, 1), 200);

  // Hosted rooms + rooms where user has chatted (lightweight participant signal)
  const { data: hosted, error: hErr } = await supabaseAdmin
    .from("rooms")
    .select("*")
    .eq("host_id", userId)
    .eq("is_personal", false)
    .order("created_at", { ascending: false });

  if (hErr) throw new AppError(hErr.message, 500);

  const { data: chatRows } = await supabaseAdmin
    .from("chat_messages")
    .select("room_id")
    .eq("sender_id", userId);

  const chatRoomIds = [
    ...new Set((chatRows ?? []).map((r) => (r as { room_id: string }).room_id)),
  ].filter((id) => !(hosted ?? []).some((h) => (h as RoomRow).id === id));

  let joined: RoomRow[] = [];
  if (chatRoomIds.length) {
    const { data: extra, error: eErr } = await supabaseAdmin
      .from("rooms")
      .select("*")
      .in("id", chatRoomIds)
      .eq("is_personal", false);
    if (eErr) throw new AppError(eErr.message, 500);
    joined = (extra ?? []) as RoomRow[];
  }

  const all = [...((hosted ?? []) as RoomRow[]), ...joined];
  const hostIds = all.map((r) => r.host_id);
  const profiles = await getProfilesByIds(hostIds);

  let items = all
    .map((r) => mapMeeting(r, profiles.get(r.host_id)?.name))
    .sort((a, b) => {
      const ta = new Date(a.scheduledAt ?? a.endedAt ?? a.startedAt ?? 0).getTime();
      const tb = new Date(b.scheduledAt ?? b.endedAt ?? b.startedAt ?? 0).getTime();
      return tb - ta;
    });

  if (opts?.cursor) {
    const idx = items.findIndex((m) => m.id === opts.cursor);
    if (idx >= 0) items = items.slice(idx + 1);
  }

  const hasMore = items.length > limit;
  const slice = hasMore ? items.slice(0, limit) : items;
  return {
    items: slice,
    nextCursor: hasMore ? slice[slice.length - 1]?.id ?? null : null,
  };
}

export async function endRoom(roomId: string, userId: string): Promise<ApiRoom> {
  const room = await fetchRoom(roomId);
  if (room.host_id !== userId) {
    throw new AppError("Only the host can end this meeting", 403);
  }

  const { data, error } = await supabaseAdmin
    .from("rooms")
    .update({
      status: "ended",
      ended_at: new Date().toISOString(),
    })
    .eq("id", room.id)
    .select("*")
    .single();

  if (error || !data) throw new AppError(error?.message ?? "Could not end room", 500);
  const profiles = await getProfilesByIds([userId]);
  return mapRoom(data as RoomRow, profiles.get(userId)?.name);
}
