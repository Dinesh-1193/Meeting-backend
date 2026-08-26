import jwt from "jsonwebtoken";
import { centrifugoConfig } from "../config/env";
import { AppError } from "../middleware/error-handler";

export function isChatRealtimeConfigured(): boolean {
  return Boolean(centrifugoConfig);
}

function requireConfig() {
  if (!centrifugoConfig) {
    throw new AppError("Chat is not configured", 503);
  }
  return centrifugoConfig;
}

export function chatChannelName(channelId: string): string {
  return `$chat:${channelId}`;
}

/** Connection JWT — establishes the WebSocket, identifies the user. */
export function mintConnectionToken(userId: string): string {
  const { hmacSecret } = requireConfig();
  return jwt.sign({ sub: userId }, hmacSecret, { algorithm: "HS256", expiresIn: "1h" });
}

/**
 * Private-channel subscription JWT. Caller MUST have already verified the
 * user is a member of the channel (see chat.service.assertChannelMember).
 */
export function mintSubscriptionToken(params: { channel: string; userId: string }): string {
  const { hmacSecret } = requireConfig();
  return jwt.sign({ channel: params.channel, sub: params.userId }, hmacSecret, {
    algorithm: "HS256",
    expiresIn: "10m",
  });
}

/**
 * Publishes to Centrifugo. When `soft` is true (default for chat message events),
 * failures are logged and swallowed so DB-committed writes still succeed for the client.
 */
export async function publishToChannel(
  channel: string,
  data: unknown,
  opts?: { soft?: boolean },
): Promise<void> {
  const soft = opts?.soft !== false;
  if (!centrifugoConfig) {
    if (!soft) throw new AppError("Chat is not configured", 503);
    console.warn("[centrifugo] skip publish — not configured", channel);
    return;
  }

  try {
    const res = await fetch(`${centrifugoConfig.apiUrl}/publish`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": centrifugoConfig.apiKey,
      },
      body: JSON.stringify({ channel, data }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      if (!soft) {
        throw new AppError(`Centrifugo publish failed: ${res.status} ${text}`, 502);
      }
      console.warn("[centrifugo] publish failed", res.status, text);
    }
  } catch (err) {
    if (!soft) throw err;
    console.warn("[centrifugo] publish error", err);
  }
}
