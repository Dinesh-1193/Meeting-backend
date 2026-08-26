import type { NextFunction, Request, Response } from "express";
import type { User } from "@supabase/supabase-js";
import { getUserFromToken, createUserClient, type AppSupabase } from "../lib/supabase";
import { verifyGuestToken } from "../lib/guest-token";
import { AppError } from "./error-handler";

export interface AuthRequest extends Request {
  user: User;
  accessToken: string;
  supabase: AppSupabase;
  isGuest?: boolean;
  guestRoomId?: string;
}

function guestAsUser(claims: {
  sub: string;
  name: string;
  roomId: string;
}): User {
  return {
    id: claims.sub,
    email: `guest-${claims.sub}@guests.local`,
    app_metadata: {},
    user_metadata: {
      name: claims.name,
      guest: true,
      guestRoomId: claims.roomId,
    },
    aud: "guest",
    created_at: new Date().toISOString(),
  } as User;
}

export async function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      throw new AppError("Missing or invalid Authorization header", 401);
    }
    const token = header.slice("Bearer ".length).trim();
    if (!token) {
      throw new AppError("Missing access token", 401);
    }

    const guest = verifyGuestToken(token);
    if (guest) {
      const authReq = req as AuthRequest;
      authReq.user = guestAsUser(guest);
      authReq.accessToken = token;
      authReq.isGuest = true;
      authReq.guestRoomId = guest.roomId;
      authReq.supabase = createUserClient(token);
      next();
      return;
    }

    const user = await getUserFromToken(token);
    if (!user) {
      throw new AppError("Invalid or expired token", 401);
    }

    const authReq = req as AuthRequest;
    authReq.user = user;
    authReq.accessToken = token;
    authReq.isGuest = Boolean(user.user_metadata?.guest);
    authReq.guestRoomId =
      typeof user.user_metadata?.guestRoomId === "string"
        ? user.user_metadata.guestRoomId
        : undefined;
    authReq.supabase = createUserClient(token);
    next();
  } catch (err) {
    next(err);
  }
}

/** Blocks guest principals — dashboard, contacts, profile, etc. */
export function requireRegisteredUser(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  const authReq = req as AuthRequest;
  if (authReq.isGuest || authReq.user?.user_metadata?.guest) {
    next(new AppError("Guests cannot access this resource", 403));
    return;
  }
  next();
}

/** Optional auth — attaches user when Bearer present, otherwise continues. */
export async function optionalAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      next();
      return;
    }
    await requireAuth(req, _res, next);
  } catch {
    next();
  }
}
