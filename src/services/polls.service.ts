import { randomUUID } from "crypto";
import { z } from "zod";
import { supabaseAdmin } from "../lib/supabase";
import { AppError } from "../middleware/error-handler";
import { assertModerator } from "../lib/authorization";
import { fetchRoom } from "./rooms.service";
import { getProfilesByIds } from "./auth.service";
import type { ApiPoll, ApiQaQuestion } from "../types/api";
import type {
  PollRow,
  PollVoteRow,
  QaQuestionRow,
  QaUpvoteRow,
} from "../types/database";

export const createPollSchema = z.object({
  question: z.string().trim().min(1).max(300),
  options: z.array(z.string().trim().min(1).max(120)).min(2).max(8),
});

export const votePollSchema = z.object({
  optionId: z.string().min(1),
});

export const askQuestionSchema = z.object({
  text: z.string().trim().min(1).max(500),
});

async function mapPoll(row: PollRow): Promise<ApiPoll> {
  const { data } = await supabaseAdmin
    .from("poll_votes")
    .select("user_id, option_id")
    .eq("poll_id", row.id);
  const votes: Record<string, string> = {};
  for (const v of (data ?? []) as PollVoteRow[]) {
    votes[v.user_id] = v.option_id;
  }
  return {
    id: row.id,
    roomId: row.room_id,
    question: row.question,
    options: row.options,
    votes,
    closed: row.closed_at != null,
    createdAt: row.created_at,
  };
}

async function mapQuestion(row: QaQuestionRow): Promise<ApiQaQuestion> {
  const { data } = await supabaseAdmin
    .from("qa_upvotes")
    .select("user_id")
    .eq("question_id", row.id);
  return {
    id: row.id,
    roomId: row.room_id,
    text: row.text,
    askedById: row.asked_by_id,
    askedByName: row.asked_by_name,
    answered: row.answered,
    upvotes: ((data ?? []) as QaUpvoteRow[]).map((u) => u.user_id),
    createdAt: row.created_at,
  };
}

export async function createPoll(
  roomId: string,
  userId: string,
  input: z.infer<typeof createPollSchema>,
): Promise<ApiPoll> {
  const room = await assertModerator(roomId, userId);
  const options = input.options.map((text) => ({ id: randomUUID(), text }));

  const { data, error } = await supabaseAdmin
    .from("polls")
    .insert({
      id: randomUUID(),
      room_id: room.id,
      question: input.question,
      options,
      created_by: userId,
    })
    .select("*")
    .single();

  if (error || !data) throw new AppError(error?.message ?? "Could not create poll", 500);
  return mapPoll(data as PollRow);
}

export async function votePoll(
  pollId: string,
  userId: string,
  optionId: string,
): Promise<ApiPoll> {
  const { data: poll, error: pollErr } = await supabaseAdmin
    .from("polls")
    .select("*")
    .eq("id", pollId)
    .maybeSingle();
  if (pollErr) throw new AppError(pollErr.message, 500);
  const row = poll as PollRow | null;
  if (!row) throw new AppError("Poll not found", 404);
  if (row.closed_at) throw new AppError("This poll is closed", 400);
  if (!row.options.some((o) => o.id === optionId)) {
    throw new AppError("Invalid option", 400);
  }

  const { error } = await supabaseAdmin
    .from("poll_votes")
    .upsert(
      { poll_id: pollId, user_id: userId, option_id: optionId },
      { onConflict: "poll_id,user_id" },
    );
  if (error) throw new AppError(error.message, 500);
  return mapPoll(row);
}

export async function closePoll(
  pollId: string,
  hostId: string,
): Promise<ApiPoll> {
  const { data: poll, error: pollErr } = await supabaseAdmin
    .from("polls")
    .select("*")
    .eq("id", pollId)
    .maybeSingle();
  if (pollErr) throw new AppError(pollErr.message, 500);
  const row = poll as PollRow | null;
  if (!row) throw new AppError("Poll not found", 404);
  await assertModerator(row.room_id, hostId);

  const { data, error } = await supabaseAdmin
    .from("polls")
    .update({ closed_at: new Date().toISOString() })
    .eq("id", pollId)
    .select("*")
    .single();
  if (error || !data) throw new AppError(error?.message ?? "Could not close poll", 500);
  return mapPoll(data as PollRow);
}

export async function listPolls(roomId: string): Promise<ApiPoll[]> {
  const room = await fetchRoom(roomId);
  const { data, error } = await supabaseAdmin
    .from("polls")
    .select("*")
    .eq("room_id", room.id)
    .order("created_at", { ascending: true });
  if (error) throw new AppError(error.message, 500);
  return Promise.all(((data ?? []) as PollRow[]).map(mapPoll));
}

export async function askQuestion(
  roomId: string,
  userId: string,
  text: string,
): Promise<ApiQaQuestion> {
  const room = await fetchRoom(roomId);
  const profiles = await getProfilesByIds([userId]);
  const askedByName = profiles.get(userId)?.name ?? "Participant";

  const { data, error } = await supabaseAdmin
    .from("qa_questions")
    .insert({
      id: randomUUID(),
      room_id: room.id,
      text,
      asked_by_id: userId,
      asked_by_name: askedByName,
    })
    .select("*")
    .single();
  if (error || !data) throw new AppError(error?.message ?? "Could not ask question", 500);
  return mapQuestion(data as QaQuestionRow);
}

export async function toggleUpvote(
  questionId: string,
  userId: string,
): Promise<ApiQaQuestion> {
  const { data: question, error: qErr } = await supabaseAdmin
    .from("qa_questions")
    .select("*")
    .eq("id", questionId)
    .maybeSingle();
  if (qErr) throw new AppError(qErr.message, 500);
  const row = question as QaQuestionRow | null;
  if (!row) throw new AppError("Question not found", 404);

  const { data: existing } = await supabaseAdmin
    .from("qa_upvotes")
    .select("*")
    .eq("question_id", questionId)
    .eq("user_id", userId)
    .maybeSingle();

  if (existing) {
    await supabaseAdmin
      .from("qa_upvotes")
      .delete()
      .eq("question_id", questionId)
      .eq("user_id", userId);
  } else {
    await supabaseAdmin.from("qa_upvotes").insert({ question_id: questionId, user_id: userId });
  }
  return mapQuestion(row);
}

export async function markAnswered(
  questionId: string,
  hostId: string,
): Promise<ApiQaQuestion> {
  const { data: question, error: qErr } = await supabaseAdmin
    .from("qa_questions")
    .select("*")
    .eq("id", questionId)
    .maybeSingle();
  if (qErr) throw new AppError(qErr.message, 500);
  const row = question as QaQuestionRow | null;
  if (!row) throw new AppError("Question not found", 404);
  await assertModerator(row.room_id, hostId);

  const { data, error } = await supabaseAdmin
    .from("qa_questions")
    .update({ answered: true })
    .eq("id", questionId)
    .select("*")
    .single();
  if (error || !data) throw new AppError(error?.message ?? "Could not mark answered", 500);
  return mapQuestion(data as QaQuestionRow);
}

export async function listQuestions(roomId: string): Promise<ApiQaQuestion[]> {
  const room = await fetchRoom(roomId);
  const { data, error } = await supabaseAdmin
    .from("qa_questions")
    .select("*")
    .eq("room_id", room.id)
    .order("created_at", { ascending: true });
  if (error) throw new AppError(error.message, 500);
  return Promise.all(((data ?? []) as QaQuestionRow[]).map(mapQuestion));
}
