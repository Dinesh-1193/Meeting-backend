import { TrackSource } from "@livekit/protocol";
import { supabaseAdmin } from "../lib/supabase";
import { roomServiceClient, grantForRole } from "../lib/livekit";
import { AppError } from "../middleware/error-handler";
import { assertHost, assertModerator } from "../lib/authorization";
import type { ParticipantRole } from "../types/database";

export async function muteParticipant(
  roomId: string,
  identity: string,
  userId: string,
): Promise<void> {
  const room = await assertModerator(roomId, userId);

  let participant;
  try {
    participant = await roomServiceClient.getParticipant(room.id, identity);
  } catch {
    throw new AppError("Participant not found in the live room", 404);
  }

  const micTrack = participant.tracks.find(
    (t) => t.source === TrackSource.MICROPHONE,
  );
  if (!micTrack) {
    throw new AppError("Participant has no active microphone track", 404);
  }

  await roomServiceClient.mutePublishedTrack(room.id, identity, micTrack.sid, true);
}

export async function muteAllParticipants(
  roomId: string,
  userId: string,
): Promise<void> {
  const room = await assertModerator(roomId, userId);

  let participants;
  try {
    participants = await roomServiceClient.listParticipants(room.id);
  } catch {
    throw new AppError("Could not reach the live room", 502);
  }

  await Promise.all(
    participants
      .filter((p) => p.identity !== userId)
      .flatMap((p) =>
        p.tracks
          .filter((t) => t.source === TrackSource.MICROPHONE && !t.muted)
          .map((t) =>
            roomServiceClient
              .mutePublishedTrack(room.id, p.identity, t.sid, true)
              .catch(() => undefined),
          ),
      ),
  );
}

export async function setMeetingLocked(
  roomId: string,
  userId: string,
  locked: boolean,
): Promise<void> {
  const room = await assertModerator(roomId, userId);
  const { error } = await supabaseAdmin
    .from("rooms")
    .update({ is_locked: locked })
    .eq("id", room.id);
  if (error) throw new AppError(error.message, 500);
}

export async function removeParticipant(
  roomId: string,
  identity: string,
  userId: string,
): Promise<void> {
  const room = await assertModerator(roomId, userId);
  try {
    await roomServiceClient.removeParticipant(room.id, identity);
  } catch {
    // already gone — treat as success
  }

  await supabaseAdmin
    .from("room_participants")
    .update({ status: "left", left_at: new Date().toISOString() })
    .eq("room_id", room.id)
    .eq("user_id", identity);
}

async function applyRoleChange(
  room: { id: string },
  identity: string,
  role: ParticipantRole,
): Promise<void> {
  const grant = grantForRole(role);
  try {
    await roomServiceClient.updateParticipant(room.id, identity, {
      attributes: { role },
      permission: {
        canPublish: grant.canPublish,
        canSubscribe: grant.canSubscribe,
        canPublishData: grant.canPublishData,
        hidden: grant.hidden,
      },
    });
  } catch {
    // participant may not be connected yet — role change on the DB row
    // will still take effect the next time they mint a token.
  }

  const { error } = await supabaseAdmin
    .from("room_participants")
    .update({ role })
    .eq("room_id", room.id)
    .eq("user_id", identity);

  if (error) throw new AppError(error.message, 500);
}

export async function setParticipantRole(
  roomId: string,
  identity: string,
  role: Extract<ParticipantRole, "panelist" | "attendee">,
  userId: string,
): Promise<void> {
  const room = await assertModerator(roomId, userId);
  if (room.mode !== "webinar") {
    throw new AppError("Role changes only apply to webinar rooms", 400);
  }
  await applyRoleChange(room, identity, role);
}

/** Granting/revoking co-host is host-only — a co-host can't create more co-hosts. */
export async function setCohost(
  roomId: string,
  identity: string,
  isCohost: boolean,
  hostId: string,
): Promise<void> {
  const room = await assertHost(roomId, hostId);
  if (identity === hostId) {
    throw new AppError("The host is already the top-level moderator", 400);
  }

  // Demoting a co-host: we don't track their pre-cohost role, so fall back
  // to the mode's default participant role.
  const fallbackRole: ParticipantRole = room.mode === "webinar" ? "attendee" : "panelist";
  await applyRoleChange(room, identity, isCohost ? "cohost" : fallbackRole);
}
