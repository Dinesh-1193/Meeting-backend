import jwt from "jsonwebtoken";
import { randomUUID } from "crypto";
import { env } from "../config/env";
import { AppError } from "../middleware/error-handler";

export interface GuestClaims {
  sub: string;
  name: string;
  roomId: string;
  typ: "guest";
}

function guestSecret(): string {
  const secret = env.GUEST_JWT_SECRET || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret || secret.length < 16) {
    throw new AppError("Guest join is not configured", 503);
  }
  return secret;
}

export function createGuestToken(input: {
  name: string;
  roomId: string;
  guestId?: string;
}): { token: string; guestId: string; expiresIn: number } {
  const guestId = input.guestId ?? randomUUID();
  const expiresIn = 60 * 60 * 12; // 12h
  const token = jwt.sign(
    {
      sub: guestId,
      name: input.name,
      roomId: input.roomId,
      typ: "guest",
    } satisfies GuestClaims,
    guestSecret(),
    { expiresIn },
  );
  return { token, guestId, expiresIn };
}

export function verifyGuestToken(token: string): GuestClaims | null {
  try {
    const payload = jwt.verify(token, guestSecret()) as jwt.JwtPayload;
    if (payload.typ !== "guest" || typeof payload.sub !== "string") return null;
    if (typeof payload.roomId !== "string" || typeof payload.name !== "string") return null;
    return {
      sub: payload.sub,
      name: payload.name,
      roomId: payload.roomId,
      typ: "guest",
    };
  } catch {
    return null;
  }
}
