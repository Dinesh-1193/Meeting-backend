import type {
  Profile,
  RoomRow,
  RecordingRow,
  ChatMessageRow,
  RoomParticipantRow,
  BreakoutRoomRow,
} from "../types/database";
import type {
  ApiUser,
  ApiRoom,
  ApiRecording,
  RecordingSummary,
  ChatMessage,
  MeetingSummary,
  Contact,
  ApiRoomParticipant,
  ApiBreakoutRoom,
} from "../types/api";
import { buildMeetingJoinUrl, formatJoinCode } from "./ids";
import { env } from "../config/env";

export function mapUser(profile: Profile, opts?: { isGuest?: boolean }): ApiUser {
  return {
    id: profile.id,
    email: profile.email,
    name: profile.name,
    avatarUrl: profile.avatar_url,
    title: profile.title,
    createdAt: profile.created_at,
    isGuest: opts?.isGuest,
  };
}

export function mapRoom(room: RoomRow, hostName?: string): ApiRoom {
  const joinCode = formatJoinCode(room.join_code || room.id);
  return {
    id: room.id,
    name: room.name,
    hostId: room.host_id,
    hostName,
    status: room.status,
    mode: room.mode,
    joinCode,
    joinLink: buildMeetingJoinUrl(env.APP_PUBLIC_URL, joinCode),
    scheduledAt: room.scheduled_at,
    startedAt: room.started_at,
    endedAt: room.ended_at,
    settings: room.settings ?? {},
    description: room.description,
    timezone: room.timezone,
    invitedEmails: room.invited_emails ?? [],
    alternateHosts: room.alternate_hosts ?? [],
    recurrenceRule: room.recurrence_rule,
    recurrenceGroupId: room.recurrence_group_id,
    cancelledAt: room.cancelled_at,
    isLocked: room.is_locked,
    passcode: room.passcode,
    breakoutDeadline: room.breakout_deadline,
    broadcastMessage: room.broadcast_message,
    broadcastMessageId: room.broadcast_message_id,
    createdAt: room.created_at,
  };
}

export function mapMeeting(
  room: RoomRow,
  hostName?: string,
): MeetingSummary {
  const joinCode = formatJoinCode(room.join_code || room.id);
  return {
    id: room.id,
    roomId: room.id,
    name: room.name,
    status: room.status,
    mode: room.mode,
    hostId: room.host_id,
    hostName,
    scheduledAt: room.scheduled_at,
    startedAt: room.started_at,
    endedAt: room.ended_at,
    participantCount: room.participant_count,
    durationMinutes: room.duration_minutes ?? undefined,
    description: room.description,
    recurrenceRule: room.recurrence_rule,
    recurrenceGroupId: room.recurrence_group_id,
    settings: room.settings,
    invitedEmails: room.invited_emails ?? [],
    alternateHosts: room.alternate_hosts ?? [],
    passcode: room.passcode,
    joinCode,
    joinLink: buildMeetingJoinUrl(env.APP_PUBLIC_URL, joinCode),
  };
}

export function mapRoomParticipant(row: RoomParticipantRow): ApiRoomParticipant {
  return {
    id: row.id,
    roomId: row.room_id,
    userId: row.user_id,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    requestedAt: row.requested_at,
    joinedAt: row.joined_at,
  };
}

export function mapBreakoutRoom(
  row: BreakoutRoomRow,
  assignedUserIds: string[],
): ApiBreakoutRoom {
  return {
    id: row.id,
    parentRoomId: row.parent_room_id,
    name: row.name,
    createdAt: row.created_at,
    endedAt: row.ended_at,
    assignedUserIds,
  };
}

export function mapRecording(row: RecordingRow): ApiRecording {
  return {
    id: row.id,
    roomId: row.room_id,
    url: row.url ?? undefined,
    status: row.status,
    durationSeconds: row.duration_seconds ?? undefined,
    shareExpiresAt: row.share_expires_at,
    createdAt: row.created_at,
  };
}

export function mapRecordingSummary(
  row: RecordingRow,
  roomName: string,
  hostName?: string,
): RecordingSummary {
  return {
    ...mapRecording(row),
    name: roomName,
    hostName,
  };
}

export function mapChat(row: ChatMessageRow): ChatMessage {
  return {
    id: row.id,
    roomId: row.room_id,
    senderId: row.sender_id,
    senderName: row.sender_name,
    body: row.body,
    createdAt: row.created_at,
  };
}

export function mapContact(
  profile: Profile,
  status: Contact["status"] = "offline",
): Contact {
  return {
    id: profile.id,
    name: profile.name,
    email: profile.email,
    status,
    title: profile.title ?? undefined,
  };
}

export function derivePresenceStatus(
  profile: Profile,
  inMeetingUserIds: Set<string>,
  now = Date.now(),
): Contact["status"] {
  if (inMeetingUserIds.has(profile.id)) return "in-meeting";
  if (!profile.last_seen_at) return "offline";
  const ageMs = now - new Date(profile.last_seen_at).getTime();
  if (ageMs <= 2 * 60 * 1000) return "online";
  if (ageMs <= 10 * 60 * 1000) return "away";
  return "offline";
}
