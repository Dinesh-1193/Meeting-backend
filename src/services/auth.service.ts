import { z } from "zod";
import { supabaseAdmin, supabaseAuth } from "../lib/supabase";
import { mapUser } from "../lib/mappers";
import { createGuestToken } from "../lib/guest-token";
import { uploadAvatar } from "../lib/r2-upload";
import { AppError } from "../middleware/error-handler";
import type { AuthResponse, ApiUser } from "../types/api";
import type { Profile } from "../types/database";
import { ensurePersonalRoom } from "./rooms.service";
import { env } from "../config/env";
import { roomLookupOrFilter } from "../lib/ids";
import type { RoomRow } from "../types/database";

export const signupSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  email: z.string().trim().email("Enter a valid email"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

export const loginSchema = z.object({
  email: z.string().trim().email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export const updateProfileSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  title: z.string().trim().max(120).nullable().optional(),
  avatarUrl: z.string().url().nullable().optional(),
});

export const forgotPasswordSchema = z.object({
  email: z.string().trim().email(),
});

export const resetPasswordSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1).optional(),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

export const oauthSessionSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1).optional(),
});

export const guestSchema = z.object({
  roomId: z.string().trim().min(1),
  displayName: z.string().trim().min(1).max(120),
  passcode: z.string().trim().max(20).optional(),
});

async function getOrCreateProfile(
  userId: string,
  fallback: { email: string; name: string; avatarUrl?: string | null },
): Promise<Profile> {
  const { data: existing, error: fetchError } = await supabaseAdmin
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  if (fetchError) {
    throw new AppError(fetchError.message, 500);
  }
  if (existing) return existing as Profile;

  const { data: created, error: insertError } = await supabaseAdmin
    .from("profiles")
    .insert({
      id: userId,
      email: fallback.email,
      name: fallback.name,
      avatar_url: fallback.avatarUrl ?? null,
    })
    .select("*")
    .single();

  if (insertError || !created) {
    throw new AppError(insertError?.message ?? "Could not create profile", 500);
  }
  return created as Profile;
}

export async function signup(input: z.infer<typeof signupSchema>): Promise<AuthResponse> {
  const email = input.email.toLowerCase();
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password: input.password,
    email_confirm: true,
    user_metadata: { name: input.name },
  });

  if (error || !data.user) {
    const msg = error?.message ?? "Signup failed";
    const conflict =
      msg.toLowerCase().includes("already") ||
      msg.toLowerCase().includes("registered");
    throw new AppError(msg, conflict ? 409 : 400);
  }

  const { data: session, error: loginError } =
    await supabaseAuth.auth.signInWithPassword({
      email,
      password: input.password,
    });

  if (loginError || !session.session) {
    throw new AppError(loginError?.message ?? "Account created but login failed", 500);
  }

  const profile = await getOrCreateProfile(data.user.id, {
    email,
    name: input.name,
  });

  if (env.ENABLE_PERSONAL_ROOMS) {
    await ensurePersonalRoom(profile.id, profile.name);
  }

  return {
    user: mapUser(profile),
    accessToken: session.session.access_token,
    refreshToken: session.session.refresh_token,
  };
}

export async function login(input: z.infer<typeof loginSchema>): Promise<AuthResponse> {
  const email = input.email.toLowerCase();
  const { data, error } = await supabaseAuth.auth.signInWithPassword({
    email,
    password: input.password,
  });

  if (error || !data.session || !data.user) {
    throw new AppError(error?.message ?? "Invalid email or password", 401);
  }

  const name =
    (data.user.user_metadata?.name as string | undefined) ||
    email.split("@")[0] ||
    "User";

  const profile = await getOrCreateProfile(data.user.id, {
    email: data.user.email ?? email,
    name,
  });

  if (env.ENABLE_PERSONAL_ROOMS) {
    await ensurePersonalRoom(profile.id, profile.name);
  }

  return {
    user: mapUser(profile),
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
  };
}

export async function refreshSession(
  refreshToken: string,
): Promise<AuthResponse> {
  const { data, error } = await supabaseAuth.auth.refreshSession({
    refresh_token: refreshToken,
  });
  if (error || !data.session || !data.user) {
    throw new AppError(error?.message ?? "Invalid refresh token", 401);
  }

  const email = data.user.email ?? `${data.user.id}@users.local`;
  const name =
    (data.user.user_metadata?.name as string | undefined) ||
    email.split("@")[0] ||
    "User";
  const profile = await getOrCreateProfile(data.user.id, { email, name });

  return {
    user: mapUser(profile),
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
  };
}

export async function logout(userId: string): Promise<void> {
  const { error } = await supabaseAdmin.auth.admin.signOut(userId, "global");
  if (error) {
    // Still succeed for the client — token will be discarded locally.
    console.warn("[auth] signOut failed", error.message);
  }
}

export async function getMe(userId: string, isGuest?: boolean): Promise<ApiUser> {
  if (isGuest) {
    return {
      id: userId,
      email: `guest-${userId}@guests.local`,
      name: "Guest",
      isGuest: true,
    };
  }

  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw new AppError(error.message, 500);
  if (!data) throw new AppError("Profile not found", 404);
  return mapUser(data as Profile);
}

export async function updateProfile(
  userId: string,
  patch: z.infer<typeof updateProfileSchema>,
): Promise<ApiUser> {
  const updates: Record<string, unknown> = {};
  if (patch.name !== undefined) updates.name = patch.name;
  if (patch.title !== undefined) updates.title = patch.title;
  if (patch.avatarUrl !== undefined) updates.avatar_url = patch.avatarUrl;

  if (!Object.keys(updates).length) {
    return getMe(userId);
  }

  const { data, error } = await supabaseAdmin
    .from("profiles")
    .update(updates)
    .eq("id", userId)
    .select("*")
    .single();

  if (error || !data) {
    throw new AppError(error?.message ?? "Could not update profile", 500);
  }
  return mapUser(data as Profile);
}

export async function uploadUserAvatar(
  userId: string,
  file: Express.Multer.File,
): Promise<ApiUser> {
  if (!file?.buffer?.length) {
    throw new AppError("Avatar file is required", 400);
  }
  if (!file.mimetype.startsWith("image/")) {
    throw new AppError("Avatar must be an image", 400);
  }

  const url = await uploadAvatar(userId, file.buffer, file.originalname, file.mimetype);
  return updateProfile(userId, { avatarUrl: url });
}

export async function forgotPassword(email: string): Promise<void> {
  const redirectTo = `${env.APP_PUBLIC_URL}/reset-password`;
  const { error } = await supabaseAuth.auth.resetPasswordForEmail(email.toLowerCase(), {
    redirectTo,
  });
  if (error) throw new AppError(error.message, 400);
}

export async function resetPassword(
  input: z.infer<typeof resetPasswordSchema>,
): Promise<void> {
  const client = supabaseAuth;
  const { error: sessionError } = await client.auth.setSession({
    access_token: input.accessToken,
    refresh_token: input.refreshToken ?? "",
  });
  if (sessionError) {
    throw new AppError(sessionError.message ?? "Invalid reset session", 401);
  }

  const { error } = await client.auth.updateUser({ password: input.password });
  if (error) throw new AppError(error.message, 400);

  await client.auth.signOut();
}

export async function exchangeOAuthSession(
  input: z.infer<typeof oauthSessionSchema>,
): Promise<AuthResponse> {
  const user = await supabaseAdmin.auth.getUser(input.accessToken);
  if (user.error || !user.data.user) {
    throw new AppError("Invalid OAuth session", 401);
  }

  const authUser = user.data.user;
  const email = (authUser.email ?? `${authUser.id}@users.local`).toLowerCase();
  const name =
    (authUser.user_metadata?.full_name as string | undefined) ||
    (authUser.user_metadata?.name as string | undefined) ||
    email.split("@")[0] ||
    "User";
  const avatarUrl =
    (authUser.user_metadata?.avatar_url as string | undefined) ||
    (authUser.user_metadata?.picture as string | undefined) ||
    null;

  const profile = await getOrCreateProfile(authUser.id, { email, name, avatarUrl });
  if (avatarUrl && !profile.avatar_url) {
    await supabaseAdmin.from("profiles").update({ avatar_url: avatarUrl }).eq("id", profile.id);
    profile.avatar_url = avatarUrl;
  }

  if (env.ENABLE_PERSONAL_ROOMS) {
    await ensurePersonalRoom(profile.id, profile.name);
  }

  return {
    user: mapUser(profile),
    accessToken: input.accessToken,
    refreshToken: input.refreshToken,
  };
}

export async function createGuestSession(
  input: z.infer<typeof guestSchema>,
): Promise<AuthResponse> {
  const { data, error } = await supabaseAdmin
    .from("rooms")
    .select("*")
    .or(roomLookupOrFilter(input.roomId))
    .maybeSingle();
  if (error) throw new AppError(error.message, 500);
  if (!data) throw new AppError("Room not found", 404);
  const room = data as RoomRow;

  if (room.status === "ended") {
    throw new AppError("This meeting has ended", 410);
  }
  if (room.passcode && input.passcode && room.passcode !== input.passcode) {
    throw new AppError("Incorrect meeting passcode", 401);
  }

  const { token, guestId } = createGuestToken({
    name: input.displayName,
    roomId: room.id,
  });

  return {
    user: {
      id: guestId,
      email: `guest-${guestId}@guests.local`,
      name: input.displayName,
      isGuest: true,
    },
    accessToken: token,
  };
}

export async function touchPresence(userId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("profiles")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", userId);
  if (error) throw new AppError(error.message, 500);
}

export async function getProfilesByIds(
  ids: string[],
): Promise<Map<string, Profile>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const map = new Map<string, Profile>();
  if (!unique.length) return map;

  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("*")
    .in("id", unique);

  if (error) throw new AppError(error.message, 500);
  for (const row of (data ?? []) as Profile[]) {
    map.set(row.id, row);
  }
  return map;
}

/** Ensure guest can only act on their scoped room (resolved room id). */
export function assertGuestRoomAccess(
  isGuest: boolean | undefined,
  guestRoomId: string | undefined,
  resolvedRoomId: string,
): void {
  if (!isGuest) return;
  if (!guestRoomId || guestRoomId !== resolvedRoomId) {
    throw new AppError("Guest token is not valid for this room", 403);
  }
}
