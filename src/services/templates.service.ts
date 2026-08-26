import { z } from "zod";
import { supabaseAdmin } from "../lib/supabase";
import { AppError } from "../middleware/error-handler";
import type { ApiMeetingTemplate } from "../types/api";
import type { MeetingTemplateRow } from "../types/database";

const templateSettingsSchema = z.object({
  muteOnEntry: z.boolean().optional(),
  videoOffOnEntry: z.boolean().optional(),
  waitingRoom: z.boolean().optional(),
  allowChat: z.boolean().optional(),
  allowScreenShare: z.boolean().optional(),
  maxParticipants: z.number().int().positive().max(1000).optional(),
});

export const createTemplateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  mode: z.enum(["conference", "webinar"]).optional().default("conference"),
  durationMinutes: z.coerce.number().int().positive().max(24 * 60).optional().default(30),
  settings: templateSettingsSchema.optional().default({}),
});

function mapTemplate(row: MeetingTemplateRow): ApiMeetingTemplate {
  return {
    id: row.id,
    name: row.name,
    mode: row.mode,
    durationMinutes: row.duration_minutes,
    settings: row.settings,
    createdAt: row.created_at,
  };
}

export async function listTemplates(userId: string): Promise<ApiMeetingTemplate[]> {
  const { data, error } = await supabaseAdmin
    .from("meeting_templates")
    .select("*")
    .eq("owner_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw new AppError(error.message, 500);
  return ((data ?? []) as MeetingTemplateRow[]).map(mapTemplate);
}

export async function createTemplate(
  userId: string,
  input: z.infer<typeof createTemplateSchema>,
): Promise<ApiMeetingTemplate> {
  const { data, error } = await supabaseAdmin
    .from("meeting_templates")
    .insert({
      owner_id: userId,
      name: input.name,
      mode: input.mode,
      duration_minutes: input.durationMinutes,
      settings: input.settings,
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new AppError(error?.message ?? "Could not save template", 500);
  }
  return mapTemplate(data as MeetingTemplateRow);
}

export async function deleteTemplate(userId: string, templateId: string): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from("meeting_templates")
    .delete()
    .eq("id", templateId)
    .eq("owner_id", userId)
    .select("id")
    .maybeSingle();

  if (error) throw new AppError(error.message, 500);
  if (!data) throw new AppError("Template not found", 404);
}
