import { randomUUID } from "crypto";
import { supabaseAdmin } from "../lib/supabase";
import { AppError } from "../middleware/error-handler";
import { assertModerator } from "../lib/authorization";
import { newRoomId } from "../lib/ids";
import { fetchRoom, issueRoomToken } from "./rooms.service";
import { mapBreakoutRoom } from "../lib/mappers";
import type { ApiBreakoutRoom, RoomTokenResponse } from "../types/api";
import type { BreakoutAssignmentRow, BreakoutRoomRow } from "../types/database";

async function activeBreakoutRoomIds(parentRoomId: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from("breakout_rooms")
    .select("id")
    .eq("parent_room_id", parentRoomId)
    .is("ended_at", null);
  if (error) throw new AppError(error.message, 500);
  return ((data ?? []) as { id: string }[]).map((r) => r.id);
}

async function getAssignments(
  breakoutIds: string[],
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (!breakoutIds.length) return map;

  const { data, error } = await supabaseAdmin
    .from("breakout_assignments")
    .select("*")
    .in("breakout_room_id", breakoutIds);

  if (error) throw new AppError(error.message, 500);
  for (const row of (data ?? []) as BreakoutAssignmentRow[]) {
    const list = map.get(row.breakout_room_id) ?? [];
    list.push(row.user_id);
    map.set(row.breakout_room_id, list);
  }
  return map;
}

export async function createBreakouts(
  parentRoomId: string,
  hostId: string,
  count: number,
  /** Keyed by 0-based room index (as a string) — the client can't know the
   * server-generated room ids before this call, but it always knows how
   * many rooms it asked for. */
  assignments?: Record<string, string[]>,
): Promise<ApiBreakoutRoom[]> {
  const room = await assertModerator(parentRoomId, hostId);

  let participantIds: string[];
  if (assignments) {
    participantIds = [];
  } else {
    const { data: participants, error: pErr } = await supabaseAdmin
      .from("room_participants")
      .select("user_id")
      .eq("room_id", room.id)
      .in("status", ["admitted", "joined"])
      .neq("user_id", room.host_id);
    if (pErr) throw new AppError(pErr.message, 500);
    participantIds = ((participants ?? []) as { user_id: string }[]).map((p) => p.user_id);
  }

  const breakoutRows = Array.from({ length: count }, (_, i) => {
    const id = `${room.id}-bo-${newRoomId().slice(0, 6)}`;
    return { id, name: `Breakout Room ${i + 1}`, index: i };
  });

  const { error: roomsErr } = await supabaseAdmin.from("rooms").insert(
    breakoutRows.map((b) => ({
      id: b.id,
      name: b.name,
      host_id: room.host_id,
      status: "waiting",
      mode: "conference",
      join_code: b.id,
      settings: { allowChat: true, allowScreenShare: true, maxParticipants: 50 },
      is_personal: false,
      participant_count: 0,
    })),
  );
  if (roomsErr) throw new AppError(roomsErr.message, 500);

  const { error: brErr } = await supabaseAdmin.from("breakout_rooms").insert(
    breakoutRows.map((b) => ({ id: b.id, parent_room_id: room.id, name: b.name })),
  );
  if (brErr) throw new AppError(brErr.message, 500);

  const assignmentRows: { breakout_room_id: string; user_id: string }[] = [];
  if (assignments) {
    for (const [indexStr, userIds] of Object.entries(assignments)) {
      const target = breakoutRows[Number(indexStr)];
      if (!target) continue;
      for (const userId of userIds) {
        assignmentRows.push({ breakout_room_id: target.id, user_id: userId });
      }
    }
  } else {
    participantIds.forEach((userId, i) => {
      const target = breakoutRows[i % breakoutRows.length];
      assignmentRows.push({ breakout_room_id: target.id, user_id: userId });
    });
  }

  if (assignmentRows.length) {
    const { error: aErr } = await supabaseAdmin
      .from("breakout_assignments")
      .insert(assignmentRows);
    if (aErr) throw new AppError(aErr.message, 500);
  }

  const assignmentMap = await getAssignments(breakoutRows.map((b) => b.id));
  return breakoutRows.map((b) =>
    mapBreakoutRoom(
      { id: b.id, parent_room_id: room.id, name: b.name, created_at: new Date().toISOString(), ended_at: null },
      assignmentMap.get(b.id) ?? [],
    ),
  );
}

export async function listBreakouts(
  parentRoomId: string,
  userId: string,
): Promise<ApiBreakoutRoom[]> {
  const room = await assertModerator(parentRoomId, userId);

  const { data, error } = await supabaseAdmin
    .from("breakout_rooms")
    .select("*")
    .eq("parent_room_id", room.id)
    .is("ended_at", null)
    .order("created_at", { ascending: true });
  if (error) throw new AppError(error.message, 500);

  const rows = (data ?? []) as BreakoutRoomRow[];
  const assignmentMap = await getAssignments(rows.map((r) => r.id));
  return rows.map((r) => mapBreakoutRoom(r, assignmentMap.get(r.id) ?? []));
}

export async function joinBreakout(
  parentRoomId: string,
  breakoutId: string,
  userId: string,
  displayName?: string,
): Promise<RoomTokenResponse> {
  const room = await fetchRoom(parentRoomId);

  const { data: breakout, error } = await supabaseAdmin
    .from("breakout_rooms")
    .select("*")
    .eq("id", breakoutId)
    .eq("parent_room_id", room.id)
    .maybeSingle();
  if (error) throw new AppError(error.message, 500);
  const breakoutRow = breakout as BreakoutRoomRow | null;
  if (!breakoutRow || breakoutRow.ended_at) {
    throw new AppError("This breakout room is not available", 404);
  }

  const isModerator =
    room.host_id === userId ||
    (
      await supabaseAdmin
        .from("room_participants")
        .select("role")
        .eq("room_id", room.id)
        .eq("user_id", userId)
        .maybeSingle()
    ).data?.role === "cohost";

  if (!isModerator) {
    const { data: assignment } = await supabaseAdmin
      .from("breakout_assignments")
      .select("user_id")
      .eq("breakout_room_id", breakoutId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!assignment) {
      throw new AppError("You are not assigned to this breakout room", 403);
    }
  }

  return issueRoomToken(breakoutId, userId, displayName);
}

export async function endBreakouts(parentRoomId: string, userId: string): Promise<void> {
  const room = await assertModerator(parentRoomId, userId);

  const { data: active, error } = await supabaseAdmin
    .from("breakout_rooms")
    .select("id")
    .eq("parent_room_id", room.id)
    .is("ended_at", null);
  if (error) throw new AppError(error.message, 500);

  const ids = ((active ?? []) as { id: string }[]).map((r) => r.id);
  if (!ids.length) return;

  const now = new Date().toISOString();
  await supabaseAdmin.from("breakout_rooms").update({ ended_at: now }).in("id", ids);
  await supabaseAdmin
    .from("rooms")
    .update({ status: "ended", ended_at: now })
    .in("id", ids);
}

/**
 * Sets (or clears, when `minutes` is null) a shared countdown deadline.
 * Breakout participants are in a different LiveKit room than the parent, so
 * this is mirrored onto every active breakout child room's `rooms` row —
 * their existing status poll (GET /rooms/:breakoutId) already reads from it.
 */
export async function setBreakoutTimer(
  parentRoomId: string,
  hostId: string,
  minutes: number | null,
): Promise<string | null> {
  const room = await assertModerator(parentRoomId, hostId);
  const deadline = minutes ? new Date(Date.now() + minutes * 60_000).toISOString() : null;

  const ids = await activeBreakoutRoomIds(room.id);
  if (!ids.length) {
    throw new AppError("No active breakout rooms", 400);
  }

  await supabaseAdmin
    .from("rooms")
    .update({ breakout_deadline: deadline })
    .in("id", [room.id, ...ids]);

  return deadline;
}

/** Broadcasts a message to everyone currently in a breakout room, via the same status-poll mirroring as the timer. */
export async function sendBreakoutBroadcast(
  parentRoomId: string,
  hostId: string,
  message: string,
): Promise<{ message: string; messageId: string }> {
  const room = await assertModerator(parentRoomId, hostId);

  const ids = await activeBreakoutRoomIds(room.id);
  if (!ids.length) {
    throw new AppError("No active breakout rooms", 400);
  }

  const messageId = randomUUID();
  await supabaseAdmin
    .from("rooms")
    .update({ broadcast_message: message, broadcast_message_id: messageId })
    .in("id", [room.id, ...ids]);

  return { message, messageId };
}
