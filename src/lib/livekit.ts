import { TrackSource } from "@livekit/protocol";
import {
  AccessToken,
  EgressClient,
  RoomServiceClient,
  WebhookReceiver,
} from "livekit-server-sdk";
import { env } from "../config/env";
import type { ParticipantRole } from "../types/database";

/** RoomServiceClient/EgressClient want an http(s) host, tokens/websockets use wss:// */
function toHttpUrl(wsUrl: string): string {
  return wsUrl.replace(/^ws/, "http");
}

const httpUrl = toHttpUrl(env.LIVEKIT_URL);

export const roomServiceClient = new RoomServiceClient(
  httpUrl,
  env.LIVEKIT_API_KEY,
  env.LIVEKIT_API_SECRET,
);

export const egressClient = new EgressClient(
  httpUrl,
  env.LIVEKIT_API_KEY,
  env.LIVEKIT_API_SECRET,
);

export const webhookReceiver = new WebhookReceiver(
  env.LIVEKIT_API_KEY,
  env.LIVEKIT_API_SECRET,
);

interface RoleGrant {
  canPublish: boolean;
  canSubscribe: boolean;
  canPublishData: boolean;
  roomAdmin: boolean;
  hidden: boolean;
}

const roleGrants: Record<ParticipantRole, RoleGrant> = {
  host: {
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    roomAdmin: true,
    hidden: false,
  },
  cohost: {
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    roomAdmin: true,
    hidden: false,
  },
  panelist: {
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    roomAdmin: false,
    hidden: false,
  },
  attendee: {
    canPublish: false,
    canSubscribe: true,
    canPublishData: true,
    roomAdmin: false,
    hidden: true,
  },
};

const ALL_PUBLISH_SOURCES = [
  TrackSource.CAMERA,
  TrackSource.MICROPHONE,
  TrackSource.SCREEN_SHARE,
  TrackSource.SCREEN_SHARE_AUDIO,
];

export function grantForRole(role: ParticipantRole): RoleGrant {
  return roleGrants[role];
}

export async function createLiveKitToken(options: {
  roomName: string;
  identity: string;
  name: string;
  role: ParticipantRole;
  allowScreenShare?: boolean;
  metadata?: Record<string, unknown>;
}): Promise<{ token: string; serverUrl: string }> {
  const grant = grantForRole(options.role);
  const isModerator = options.role === "host" || options.role === "cohost";
  const canPublishSources =
    grant.canPublish && !isModerator && options.allowScreenShare === false
      ? ALL_PUBLISH_SOURCES.filter((s) => s !== TrackSource.SCREEN_SHARE)
      : undefined;

  const at = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
    identity: options.identity,
    name: options.name,
    metadata: JSON.stringify({ role: options.role, ...options.metadata }),
    attributes: { role: options.role },
    // 6 hours — long enough for most meetings
    ttl: "6h",
  });

  at.addGrant({
    roomJoin: true,
    room: options.roomName,
    canPublish: grant.canPublish,
    canSubscribe: grant.canSubscribe,
    canPublishData: grant.canPublishData,
    roomAdmin: grant.roomAdmin,
    hidden: grant.hidden,
    canUpdateOwnMetadata: true,
    ...(canPublishSources ? { canPublishSources } : {}),
  });

  const token = await at.toJwt();
  return { token, serverUrl: env.LIVEKIT_URL };
}
