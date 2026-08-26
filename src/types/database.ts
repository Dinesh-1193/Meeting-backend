export type RoomStatus = "scheduled" | "waiting" | "live" | "ended";
export type RoomMode = "conference" | "webinar";
export type RecordingStatus = "processing" | "ready" | "failed";
export type ContactStatus = "online" | "offline" | "in-meeting" | "away";
export type ParticipantRole = "host" | "cohost" | "panelist" | "attendee";
export type ParticipantStatus = "pending" | "admitted" | "denied" | "joined" | "left";
export type RecurrenceRule = "none" | "daily" | "weekly";

export interface RoomSettings {
  muteOnEntry?: boolean;
  videoOffOnEntry?: boolean;
  waitingRoom?: boolean;
  allowChat?: boolean;
  allowScreenShare?: boolean;
  maxParticipants?: number;
}

export interface Profile {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  title: string | null;
  last_seen_at: string | null;
  created_at: string;
}

export interface NotificationRow {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  href: string | null;
  read_at: string | null;
  created_at: string;
}

export interface RoomRow {
  id: string;
  name: string;
  host_id: string;
  status: RoomStatus;
  mode: RoomMode;
  join_code: string;
  scheduled_at: string | null;
  started_at: string | null;
  ended_at: string | null;
  settings: RoomSettings;
  duration_minutes: number | null;
  participant_count: number;
  is_personal: boolean;
  is_locked: boolean;
  passcode: string | null;
  breakout_deadline: string | null;
  broadcast_message: string | null;
  broadcast_message_id: string | null;
  description: string | null;
  timezone: string | null;
  invited_emails: string[];
  alternate_hosts: string[];
  recurrence_rule: string | null;
  recurrence_group_id: string | null;
  cancelled_at: string | null;
  created_at: string;
}

export interface RecordingRow {
  id: string;
  room_id: string;
  url: string | null;
  status: RecordingStatus;
  duration_seconds: number | null;
  egress_id: string | null;
  started_at: string | null;
  ended_at: string | null;
  requested_by: string | null;
  share_expires_at: string | null;
  created_at: string;
}

export interface RoomParticipantRow {
  id: string;
  room_id: string;
  user_id: string;
  display_name: string;
  role: ParticipantRole;
  status: ParticipantStatus;
  requested_at: string;
  decided_at: string | null;
  decided_by: string | null;
  joined_at: string | null;
  left_at: string | null;
}

export interface ChatMessageRow {
  id: string;
  room_id: string;
  sender_id: string;
  sender_name: string;
  body: string;
  created_at: string;
}

export interface PollRow {
  id: string;
  room_id: string;
  question: string;
  options: { id: string; text: string }[];
  created_by: string;
  created_at: string;
  closed_at: string | null;
}

export interface PollVoteRow {
  poll_id: string;
  user_id: string;
  option_id: string;
  voted_at: string;
}

export interface QaQuestionRow {
  id: string;
  room_id: string;
  text: string;
  asked_by_id: string | null;
  asked_by_name: string;
  answered: boolean;
  created_at: string;
}

export interface QaUpvoteRow {
  question_id: string;
  user_id: string;
}

export interface MeetingTemplateRow {
  id: string;
  owner_id: string;
  name: string;
  mode: RoomMode;
  duration_minutes: number;
  settings: RoomSettings;
  created_at: string;
}

export interface BreakoutRoomRow {
  id: string;
  parent_room_id: string;
  name: string;
  created_at: string;
  ended_at: string | null;
}

export interface BreakoutAssignmentRow {
  breakout_room_id: string;
  user_id: string;
}

export interface ContactRow {
  id: string;
  owner_id: string;
  contact_user_id: string;
  created_at: string;
}

export type ChatChannelType = "dm" | "group";

export interface ChatChannelRow {
  id: string;
  type: ChatChannelType;
  dm_key: string | null;
  name: string | null;
  created_by: string;
  last_message_seq: number;
  last_message_preview: string | null;
  last_message_sender_id: string | null;
  last_message_created_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChatChannelMemberRow {
  id: string;
  channel_id: string;
  user_id: string;
  last_read_seq: number;
  joined_at: string;
  muted: boolean;
  pinned_at: string | null;
}

export interface ChatChannelMessageRow {
  id: string;
  seq: number;
  channel_id: string;
  sender_id: string;
  sender_name: string;
  body: string;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  reply_to_message_id: string | null;
  forwarded_from_sender_name: string | null;
}

export interface ChatMessageReactionRow {
  id: string;
  message_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
}

export interface ChatMessageAttachmentRow {
  id: string;
  message_id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  url: string;
  created_at: string;
}

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: Partial<Profile> & Pick<Profile, "id" | "email" | "name">;
        Update: Partial<Profile>;
      };
      rooms: {
        Row: RoomRow;
        Insert: Partial<RoomRow> &
          Pick<RoomRow, "id" | "name" | "host_id" | "join_code">;
        Update: Partial<RoomRow>;
      };
      recordings: {
        Row: RecordingRow;
        Insert: Partial<RecordingRow> & Pick<RecordingRow, "room_id">;
        Update: Partial<RecordingRow>;
      };
      chat_messages: {
        Row: ChatMessageRow;
        Insert: Partial<ChatMessageRow> &
          Pick<ChatMessageRow, "room_id" | "sender_id" | "sender_name" | "body">;
        Update: Partial<ChatMessageRow>;
      };
      contacts: {
        Row: ContactRow;
        Insert: Partial<ContactRow> &
          Pick<ContactRow, "owner_id" | "contact_user_id">;
        Update: Partial<ContactRow>;
      };
      room_participants: {
        Row: RoomParticipantRow;
        Insert: Partial<RoomParticipantRow> &
          Pick<RoomParticipantRow, "room_id" | "user_id" | "display_name">;
        Update: Partial<RoomParticipantRow>;
      };
      breakout_rooms: {
        Row: BreakoutRoomRow;
        Insert: Partial<BreakoutRoomRow> & Pick<BreakoutRoomRow, "id" | "parent_room_id" | "name">;
        Update: Partial<BreakoutRoomRow>;
      };
      breakout_assignments: {
        Row: BreakoutAssignmentRow;
        Insert: BreakoutAssignmentRow;
        Update: Partial<BreakoutAssignmentRow>;
      };
    };
  };
}
