import { supabaseAdmin } from "../lib/supabase";
import { AppError } from "../middleware/error-handler";
import { mapRoomParticipant } from "../lib/mappers";
import type { ApiRoomParticipant } from "../types/api";
import type { ParticipantStatus, RoomParticipantRow } from "../types/database";

const PAGE_SIZE = 50;

export interface ParticipantsPage {
  participants: ApiRoomParticipant[];
  nextCursor: number | null;
}

export async function listParticipants(
  roomId: string,
  options: { status?: ParticipantStatus; cursor?: number; limit?: number } = {},
): Promise<ParticipantsPage> {
  const limit = Math.min(options.limit ?? PAGE_SIZE, PAGE_SIZE);
  const offset = options.cursor ?? 0;

  let query = supabaseAdmin
    .from("room_participants")
    .select("*")
    .eq("room_id", roomId)
    .order("role", { ascending: true })
    .order("display_name", { ascending: true })
    .range(offset, offset + limit - 1);

  if (options.status) {
    query = query.eq("status", options.status);
  } else {
    query = query.in("status", ["admitted", "joined"]);
  }

  const { data, error } = await query;
  if (error) throw new AppError(error.message, 500);

  const rows = (data ?? []) as RoomParticipantRow[];
  return {
    participants: rows.map(mapRoomParticipant),
    nextCursor: rows.length === limit ? offset + limit : null,
  };
}

export async function getParticipantCounts(
  roomId: string,
): Promise<{ total: number; hosts: number; panelists: number; attendees: number }> {
  const { data, error } = await supabaseAdmin
    .from("room_participants")
    .select("role")
    .eq("room_id", roomId)
    .in("status", ["admitted", "joined"]);

  if (error) throw new AppError(error.message, 500);
  const rows = (data ?? []) as { role: string }[];

  return {
    total: rows.length,
    hosts: rows.filter((r) => r.role === "host").length,
    panelists: rows.filter((r) => r.role === "panelist").length,
    attendees: rows.filter((r) => r.role === "attendee").length,
  };
}
