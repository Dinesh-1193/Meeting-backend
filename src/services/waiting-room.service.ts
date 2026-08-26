import { supabaseAdmin } from "../lib/supabase";
import { AppError } from "../middleware/error-handler";
import { fetchRoom } from "./rooms.service";
import { assertModerator } from "../lib/authorization";
import { getProfilesByIds } from "./auth.service";
import { mapRoomParticipant } from "../lib/mappers";
import type { ApiRoomParticipant, JoinRequestResponse } from "../types/api";
import type { RoomParticipantRow } from "../types/database";

export async function requestToJoin(
  roomId: string,
  userId: string,
  displayName?: string,
  guest?: { isGuest?: boolean; guestRoomId?: string },
): Promise<JoinRequestResponse> {
  const room = await fetchRoom(roomId);
  if (guest?.isGuest) {
    const { assertGuestRoomAccess } = await import("./auth.service");
    assertGuestRoomAccess(guest.isGuest, guest.guestRoomId, room.id);
  }
  if (room.status === "ended") {
    throw new AppError("This meeting has ended", 410);
  }

  const profiles = await getProfilesByIds([userId]);
  const name = displayName?.trim() || profiles.get(userId)?.name || "Guest";
  const isHost = !guest?.isGuest && room.host_id === userId;

  const { data: existing } = await supabaseAdmin
    .from("room_participants")
    .select("*")
    .eq("room_id", room.id)
    .eq("user_id", userId)
    .maybeSingle();

  const row = existing as RoomParticipantRow | null;
  const requiresApproval = !isHost && Boolean(room.settings?.waitingRoom);
  const status =
    row && row.status !== "pending" ? row.status : requiresApproval ? "pending" : "admitted";

  const { data, error } = await supabaseAdmin
    .from("room_participants")
    .upsert(
      {
        room_id: room.id,
        user_id: userId,
        display_name: name,
        role: isHost ? "host" : (row?.role ?? (room.mode === "webinar" ? "attendee" : "panelist")),
        status,
      },
      { onConflict: "room_id,user_id" },
    )
    .select("*")
    .single();

  if (error || !data) {
    throw new AppError(error?.message ?? "Could not request to join", 500);
  }

  const saved = data as RoomParticipantRow;
  return { participantId: saved.id, status: saved.status };
}

export async function getJoinRequestStatus(
  roomId: string,
  participantId: string,
  userId: string,
): Promise<JoinRequestResponse> {
  const { data, error } = await supabaseAdmin
    .from("room_participants")
    .select("*")
    .eq("id", participantId)
    .eq("room_id", roomId)
    .maybeSingle();

  if (error) throw new AppError(error.message, 500);
  const row = data as RoomParticipantRow | null;
  if (!row || row.user_id !== userId) {
    throw new AppError("Join request not found", 404);
  }
  return { participantId: row.id, status: row.status };
}

export async function listPending(
  roomId: string,
  userId: string,
): Promise<ApiRoomParticipant[]> {
  await assertModerator(roomId, userId);
  const { data, error } = await supabaseAdmin
    .from("room_participants")
    .select("*")
    .eq("room_id", roomId)
    .eq("status", "pending")
    .order("requested_at", { ascending: true });

  if (error) throw new AppError(error.message, 500);
  return ((data ?? []) as RoomParticipantRow[]).map(mapRoomParticipant);
}

async function decide(
  roomId: string,
  participantId: string,
  userId: string,
  status: "admitted" | "denied",
): Promise<ApiRoomParticipant> {
  await assertModerator(roomId, userId);
  const { data, error } = await supabaseAdmin
    .from("room_participants")
    .update({ status, decided_at: new Date().toISOString(), decided_by: userId })
    .eq("id", participantId)
    .eq("room_id", roomId)
    .select("*")
    .single();

  if (error || !data) {
    throw new AppError(error?.message ?? "Could not update join request", 500);
  }
  return mapRoomParticipant(data as RoomParticipantRow);
}

export async function admit(
  roomId: string,
  participantId: string,
  hostId: string,
): Promise<ApiRoomParticipant> {
  return decide(roomId, participantId, hostId, "admitted");
}

export async function deny(
  roomId: string,
  participantId: string,
  hostId: string,
): Promise<ApiRoomParticipant> {
  return decide(roomId, participantId, hostId, "denied");
}
