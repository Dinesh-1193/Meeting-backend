export type RoomStatus = "scheduled" | "waiting" | "live" | "ended";
export type RoomMode = "conference" | "webinar";
export type ParticipantRole = "host" | "cohost" | "panelist" | "attendee";
export type ParticipantStatus = "pending" | "admitted" | "denied" | "joined" | "left";
export type RecurrenceRule = "none" | "daily" | "weekly";

export interface ApiUser {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string | null;
  title?: string | null;
  createdAt?: string;
  isGuest?: boolean;
}

export interface ApiNotification {
  id: string;
  type: string;
  title: string;
  body?: string | null;
  href?: string | null;
  readAt?: string | null;
  createdAt: string;
}

export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
}

export interface AuthResponse {
  user: ApiUser;
  accessToken: string;
  refreshToken?: string;
}

export interface RoomSettings {
  muteOnEntry?: boolean;
  videoOffOnEntry?: boolean;
  waitingRoom?: boolean;
  allowChat?: boolean;
  allowScreenShare?: boolean;
  maxParticipants?: number;
}

export interface ApiRoom {
  id: string;
  name: string;
  hostId: string;
  hostName?: string;
  status: RoomStatus;
  mode: RoomMode;
  joinCode?: string;
  joinLink?: string;
  scheduledAt?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
  settings?: RoomSettings;
  description?: string | null;
  timezone?: string | null;
  invitedEmails?: string[];
  alternateHosts?: string[];
  recurrenceRule?: string | null;
  recurrenceGroupId?: string | null;
  cancelledAt?: string | null;
  isLocked?: boolean;
  passcode?: string | null;
  hasPasscode?: boolean;
  breakoutDeadline?: string | null;
  broadcastMessage?: string | null;
  broadcastMessageId?: string | null;
  createdAt?: string;
}

export interface RoomTokenResponse {
  token: string;
  serverUrl?: string;
  roomId: string;
  identity: string;
  isHost: boolean;
  role: ParticipantRole;
  mode: RoomMode;
  forceMuted?: boolean;
}

export interface ApiRoomParticipant {
  id: string;
  roomId: string;
  userId: string;
  displayName: string;
  role: ParticipantRole;
  status: ParticipantStatus;
  requestedAt: string;
  joinedAt?: string | null;
}

export interface JoinRequestResponse {
  participantId: string;
  status: ParticipantStatus;
}

export interface ApiRecording {
  id: string;
  roomId: string;
  url?: string;
  status: "processing" | "ready" | "failed";
  durationSeconds?: number;
  shareExpiresAt?: string | null;
  createdAt: string;
}

export interface RecordingSummary extends ApiRecording {
  name: string;
  hostName?: string;
}

export interface ChatMessage {
  id: string;
  roomId: string;
  senderId: string;
  senderName: string;
  body: string;
  createdAt: string;
}

export interface ApiPoll {
  id: string;
  roomId: string;
  question: string;
  options: { id: string; text: string }[];
  votes: Record<string, string>;
  closed: boolean;
  createdAt: string;
}

export interface ApiMeetingTemplate {
  id: string;
  name: string;
  mode: RoomMode;
  durationMinutes: number;
  settings: RoomSettings;
  createdAt: string;
}

export interface ApiQaQuestion {
  id: string;
  roomId: string;
  text: string;
  askedById: string | null;
  askedByName: string;
  answered: boolean;
  upvotes: string[];
  createdAt: string;
}

export interface MeetingSummary {
  id: string;
  roomId: string;
  name: string;
  status: RoomStatus;
  mode?: RoomMode;
  hostId: string;
  hostName?: string;
  scheduledAt?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
  participantCount?: number;
  durationMinutes?: number;
  description?: string | null;
  recurrenceRule?: string | null;
  recurrenceGroupId?: string | null;
  settings?: RoomSettings;
  invitedEmails?: string[];
  alternateHosts?: string[];
  passcode?: string | null;
  joinCode?: string;
  joinLink?: string;
}

export interface ApiBreakoutRoom {
  id: string;
  parentRoomId: string;
  name: string;
  createdAt: string;
  endedAt?: string | null;
  assignedUserIds: string[];
}

export interface Contact {
  id: string;
  name: string;
  email: string;
  status: "online" | "offline" | "in-meeting" | "away";
  title?: string;
}

export type ChatChannelType = "dm" | "group";

export interface ApiChatChannel {
  id: string;
  type: ChatChannelType;
  name: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApiChatConversation extends ApiChatChannel {
  displayName: string;
  otherParticipant?: { id: string; name: string; avatarUrl?: string | null };
  memberCount: number;
  lastMessagePreview: string | null;
  lastMessageSenderId: string | null;
  lastMessageCreatedAt: string | null;
  unreadCount: number;
  muted: boolean;
  pinnedAt: string | null;
}

export interface ApiChatMessageReplyTo {
  id: string;
  senderId: string;
  senderName: string;
  body: string;
}

export interface ApiChatMessageReaction {
  emoji: string;
  userIds: string[];
}

export interface ApiChatMessageAttachment {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  url: string;
}

export interface ApiChatMessage {
  id: string;
  seq: string;
  channelId: string;
  senderId: string;
  senderName: string;
  body: string;
  createdAt: string;
  editedAt?: string | null;
  deletedAt?: string | null;
  replyTo?: ApiChatMessageReplyTo | null;
  forwardedFromSenderName?: string | null;
  reactions: ApiChatMessageReaction[];
  attachments: ApiChatMessageAttachment[];
}

export interface ApiChatMessagePage {
  messages: ApiChatMessage[];
  nextCursor: string | null;
}
