import { supabaseAdmin } from "../lib/supabase";
import { AppError } from "../middleware/error-handler";
import type { ApiNotification, Paginated } from "../types/api";
import type { NotificationRow } from "../types/database";

function mapNotification(row: NotificationRow): ApiNotification {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    href: row.href,
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}

export async function createNotification(input: {
  userId: string;
  type: string;
  title: string;
  body?: string | null;
  href?: string | null;
}): Promise<void> {
  const { error } = await supabaseAdmin.from("notifications").insert({
    user_id: input.userId,
    type: input.type,
    title: input.title,
    body: input.body ?? null,
    href: input.href ?? null,
  });
  if (error) {
    console.warn("[notifications] insert failed", error.message);
  }
}

export async function notifyUsersByEmails(
  emails: string[],
  payload: { type: string; title: string; body?: string; href?: string },
): Promise<void> {
  const normalized = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (!normalized.length) return;

  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("id, email")
    .in("email", normalized);
  if (error) {
    console.warn("[notifications] profile lookup failed", error.message);
    return;
  }

  for (const row of (data ?? []) as { id: string; email: string }[]) {
    await createNotification({
      userId: row.id,
      type: payload.type,
      title: payload.title,
      body: payload.body,
      href: payload.href,
    });
  }
}

export async function listNotifications(
  userId: string,
  opts?: { limit?: number; cursor?: string },
): Promise<Paginated<ApiNotification>> {
  const limit = Math.min(Math.max(opts?.limit ?? 30, 1), 100);
  let query = supabaseAdmin
    .from("notifications")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit + 1);

  if (opts?.cursor) {
    query = query.lt("created_at", opts.cursor);
  }

  const { data, error } = await query;
  if (error) throw new AppError(error.message, 500);

  const rows = (data ?? []) as NotificationRow[];
  const hasMore = rows.length > limit;
  const slice = hasMore ? rows.slice(0, limit) : rows;
  return {
    items: slice.map(mapNotification),
    nextCursor: hasMore ? slice[slice.length - 1]?.created_at ?? null : null,
  };
}

export async function markNotificationRead(
  userId: string,
  notificationId: string,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", notificationId)
    .eq("user_id", userId);
  if (error) throw new AppError(error.message, 500);
}

export async function markAllNotificationsRead(userId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("read_at", null);
  if (error) throw new AppError(error.message, 500);
}
