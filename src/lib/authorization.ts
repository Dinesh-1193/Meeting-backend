import { supabaseAdmin } from "./supabase";
import { AppError } from "../middleware/error-handler";
import { fetchRoom } from "../services/rooms.service";
import { getProfilesByIds } from "../services/auth.service";
import type { RoomRow } from "../types/database";

/** True if `userId`'s email is in the room's pre-assigned alternate-host list. */
async function isAlternateHost(room: RoomRow, userId: string): Promise<boolean> {
  if (!room.alternate_hosts?.length) return false;
  const profiles = await getProfilesByIds([userId]);
  const email = profiles.get(userId)?.email;
  return Boolean(email && room.alternate_hosts.includes(email));
}

/**
 * Host or co-host. Used for moderation/admit actions where Zoom-style
 * co-hosts should have the same power as the host.
 */
export async function assertModerator(roomId: string, userId: string): Promise<RoomRow> {
  const room = await fetchRoom(roomId);
  if (room.host_id === userId) return room;
  if (await isAlternateHost(room, userId)) return room;

  const { data } = await supabaseAdmin
    .from("room_participants")
    .select("role")
    .eq("room_id", room.id)
    .eq("user_id", userId)
    .maybeSingle();

  if ((data as { role?: string } | null)?.role === "cohost") return room;

  throw new AppError("Only the host or a co-host can do this", 403);
}

/** Host (or pre-assigned alternate host) only — for actions co-hosts shouldn't have (recording, granting co-host). */
export async function assertHost(roomId: string, userId: string): Promise<RoomRow> {
  const room = await fetchRoom(roomId);
  if (room.host_id === userId) return room;
  if (await isAlternateHost(room, userId)) return room;
  throw new AppError("Only the host can do this", 403);
}
