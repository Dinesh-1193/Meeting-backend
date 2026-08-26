import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRegisteredUser, type AuthRequest } from "../middleware/auth";
import { validateBody } from "../middleware/validate";
import { asyncHandler } from "../lib/async-handler";
import {
  cancelRoom,
  createRoom,
  createRoomSchema,
  endRoom,
  fetchRoom,
  getRoomById,
  issueRoomToken,
  updateRoom,
  updateRoomSchema,
} from "../services/rooms.service";
import { assertGuestRoomAccess } from "../services/auth.service";
import {
  listChat,
  listRoomRecordings,
  sendChat,
  sendChatSchema,
} from "../services/workspace.service";
import {
  admit,
  deny,
  getJoinRequestStatus,
  listPending,
  requestToJoin,
} from "../services/waiting-room.service";
import {
  muteAllParticipants,
  muteParticipant,
  removeParticipant,
  setCohost,
  setMeetingLocked,
  setParticipantRole,
} from "../services/moderation.service";
import {
  getParticipantCounts,
  listParticipants,
} from "../services/participants.service";
import {
  getActiveRecording,
  startRecording,
  stopRecording,
} from "../services/recording.service";
import {
  createBreakouts,
  endBreakouts,
  joinBreakout,
  listBreakouts,
  sendBreakoutBroadcast,
  setBreakoutTimer,
} from "../services/breakout.service";
import {
  askQuestion,
  askQuestionSchema,
  closePoll,
  createPoll,
  createPollSchema,
  listPolls,
  listQuestions,
  markAnswered,
  toggleUpvote,
  votePoll,
  votePollSchema,
} from "../services/polls.service";

export const roomsRouter = Router();

roomsRouter.use(requireAuth);

roomsRouter.post(
  "/",
  requireRegisteredUser,
  validateBody(createRoomSchema),
  asyncHandler(async (req, res) => {
    const authReq = req as AuthRequest;
    const room = await createRoom(authReq.user.id, req.body);
    res.status(201).json(room);
  }),
);

roomsRouter.patch(
  "/:roomId",
  requireRegisteredUser,
  validateBody(updateRoomSchema),
  asyncHandler(async (req, res) => {
    const authReq = req as AuthRequest;
    const room = await updateRoom(req.params.roomId, authReq.user.id, req.body);
    res.json(room);
  }),
);

const cancelSchema = z.object({ scope: z.enum(["this", "all"]).optional().default("this") });

roomsRouter.post(
  "/:roomId/cancel",
  requireRegisteredUser,
  validateBody(cancelSchema),
  asyncHandler(async (req, res) => {
    const authReq = req as AuthRequest;
    await cancelRoom(req.params.roomId, authReq.user.id, req.body.scope);
    res.status(204).send();
  }),
);

roomsRouter.get(
  "/:roomId",
  asyncHandler(async (req, res) => {
    const authReq = req as AuthRequest;
    const roomRow = await fetchRoom(req.params.roomId);
    assertGuestRoomAccess(authReq.isGuest, authReq.guestRoomId, roomRow.id);
    const room = await getRoomById(req.params.roomId, authReq.isGuest ? undefined : authReq.user.id);
    res.json(room);
  }),
);

roomsRouter.post(
  "/:roomId/token",
  asyncHandler(async (req, res) => {
    const authReq = req as AuthRequest;
    const displayName =
      typeof req.body?.displayName === "string"
        ? req.body.displayName
        : authReq.isGuest
          ? (authReq.user.user_metadata?.name as string | undefined)
          : undefined;
    const passcode =
      typeof req.body?.passcode === "string" ? req.body.passcode : undefined;
    const token = await issueRoomToken(
      req.params.roomId,
      authReq.user.id,
      displayName,
      passcode,
      { isGuest: authReq.isGuest, guestRoomId: authReq.guestRoomId },
    );
    res.json(token);
  }),
);

roomsRouter.get(
  "/:roomId/recordings",
  asyncHandler(async (req, res) => {
    const recordings = await listRoomRecordings(req.params.roomId);
    res.json(recordings);
  }),
);

roomsRouter.post(
  "/:roomId/chat",
  validateBody(sendChatSchema),
  asyncHandler(async (req, res) => {
    const authReq = req as AuthRequest;
    const msg = await sendChat(
      req.params.roomId,
      authReq.user.id,
      req.body.body,
    );
    res.status(201).json(msg);
  }),
);

roomsRouter.get(
  "/:roomId/chat",
  asyncHandler(async (req, res) => {
    const messages = await listChat(req.params.roomId);
    res.json(messages);
  }),
);

roomsRouter.post(
  "/:roomId/end",
  asyncHandler(async (req, res) => {
    const authReq = req as AuthRequest;
    const room = await endRoom(req.params.roomId, authReq.user.id);
    res.json(room);
  }),
);

// --- Waiting room -----------------------------------------------------

roomsRouter.post(
  "/:roomId/join-request",
  asyncHandler(async (req, res) => {
    const authReq = req as AuthRequest;
    const displayName =
      typeof req.body?.displayName === "string"
        ? req.body.displayName
        : authReq.isGuest
          ? (authReq.user.user_metadata?.name as string | undefined)
          : undefined;
    const result = await requestToJoin(req.params.roomId, authReq.user.id, displayName, {
      isGuest: authReq.isGuest,
      guestRoomId: authReq.guestRoomId,
    });
    res.status(201).json(result);
  }),
);

roomsRouter.get(
  "/:roomId/join-request/:participantId",
  asyncHandler(async (req, res) => {
    const authReq = req as AuthRequest;
    const result = await getJoinRequestStatus(
      req.params.roomId,
      req.params.participantId,
      authReq.user.id,
    );
    res.json(result);
  }),
);

roomsRouter.get(
  "/:roomId/waiting-room",
  asyncHandler(async (req, res) => {
    const authReq = req as AuthRequest;
    const pending = await listPending(req.params.roomId, authReq.user.id);
    res.json(pending);
  }),
);

roomsRouter.post(
  "/:roomId/waiting-room/:participantId/admit",
  asyncHandler(async (req, res) => {
    const authReq = req as AuthRequest;
    const result = await admit(req.params.roomId, req.params.participantId, authReq.user.id);
    res.json(result);
  }),
);

roomsRouter.post(
  "/:roomId/waiting-room/:participantId/deny",
  asyncHandler(async (req, res) => {
    const authReq = req as AuthRequest;
    const result = await deny(req.params.roomId, req.params.participantId, authReq.user.id);
    res.json(result);
  }),
);

// --- Moderation ---------------------------------------------------------

roomsRouter.post(
  "/:roomId/participants/:identity/mute",
  asyncHandler(async (req, res) => {
    const authReq = req as AuthRequest;
    await muteParticipant(req.params.roomId, req.params.identity, authReq.user.id);
    res.status(204).send();
  }),
);

roomsRouter.post(
  "/:roomId/participants/:identity/remove",
  asyncHandler(async (req, res) => {
    const authReq = req as AuthRequest;
    await removeParticipant(req.params.roomId, req.params.identity, authReq.user.id);
    res.status(204).send();
  }),
);

const roleSchema = z.object({ role: z.enum(["panelist", "attendee"]) });

roomsRouter.post(
  "/:roomId/participants/:identity/role",
  validateBody(roleSchema),
  asyncHandler(async (req, res) => {
    const authReq = req as AuthRequest;
    await setParticipantRole(
      req.params.roomId,
      req.params.identity,
      req.body.role,
      authReq.user.id,
    );
    res.status(204).send();
  }),
);

roomsRouter.post(
  "/:roomId/participants/mute-all",
  asyncHandler(async (req, res) => {
    const authReq = req as AuthRequest;
    await muteAllParticipants(req.params.roomId, authReq.user.id);
    res.status(204).send();
  }),
);

const lockSchema = z.object({ locked: z.boolean() });

roomsRouter.post(
  "/:roomId/lock",
  validateBody(lockSchema),
  asyncHandler(async (req, res) => {
    const authReq = req as AuthRequest;
    await setMeetingLocked(req.params.roomId, authReq.user.id, req.body.locked);
    res.status(204).send();
  }),
);

const cohostSchema = z.object({ isCohost: z.boolean() });

roomsRouter.post(
  "/:roomId/participants/:identity/cohost",
  validateBody(cohostSchema),
  asyncHandler(async (req, res) => {
    const authReq = req as AuthRequest;
    await setCohost(
      req.params.roomId,
      req.params.identity,
      req.body.isCohost,
      authReq.user.id,
    );
    res.status(204).send();
  }),
);

roomsRouter.get(
  "/:roomId/participants",
  asyncHandler(async (req, res) => {
    const cursor = req.query.cursor ? Number(req.query.cursor) : undefined;
    const page = await listParticipants(req.params.roomId, { cursor });
    res.json(page);
  }),
);

roomsRouter.get(
  "/:roomId/participants/count",
  asyncHandler(async (req, res) => {
    const counts = await getParticipantCounts(req.params.roomId);
    res.json(counts);
  }),
);

// --- Breakout rooms -------------------------------------------------------

const createBreakoutsSchema = z.object({
  count: z.number().int().min(1).max(50),
  assignments: z.record(z.string(), z.array(z.string())).optional(),
});

roomsRouter.post(
  "/:roomId/breakouts",
  validateBody(createBreakoutsSchema),
  asyncHandler(async (req, res) => {
    const authReq = req as AuthRequest;
    const rooms = await createBreakouts(
      req.params.roomId,
      authReq.user.id,
      req.body.count,
      req.body.assignments,
    );
    res.status(201).json(rooms);
  }),
);

roomsRouter.get(
  "/:roomId/breakouts",
  asyncHandler(async (req, res) => {
    const authReq = req as AuthRequest;
    const rooms = await listBreakouts(req.params.roomId, authReq.user.id);
    res.json(rooms);
  }),
);

roomsRouter.post(
  "/:roomId/breakouts/:breakoutId/join",
  asyncHandler(async (req, res) => {
    const authReq = req as AuthRequest;
    const displayName =
      typeof req.body?.displayName === "string" ? req.body.displayName : undefined;
    const token = await joinBreakout(
      req.params.roomId,
      req.params.breakoutId,
      authReq.user.id,
      displayName,
    );
    res.json(token);
  }),
);

roomsRouter.post(
  "/:roomId/breakouts/end",
  asyncHandler(async (req, res) => {
    const authReq = req as AuthRequest;
    await endBreakouts(req.params.roomId, authReq.user.id);
    res.status(204).send();
  }),
);

const breakoutTimerSchema = z.object({
  minutes: z.number().int().positive().max(180).nullable(),
});

roomsRouter.post(
  "/:roomId/breakouts/timer",
  validateBody(breakoutTimerSchema),
  asyncHandler(async (req, res) => {
    const authReq = req as AuthRequest;
    const deadline = await setBreakoutTimer(req.params.roomId, authReq.user.id, req.body.minutes);
    res.json({ deadline });
  }),
);

const breakoutBroadcastSchema = z.object({
  message: z.string().trim().min(1).max(300),
});

roomsRouter.post(
  "/:roomId/breakouts/broadcast",
  validateBody(breakoutBroadcastSchema),
  asyncHandler(async (req, res) => {
    const authReq = req as AuthRequest;
    const result = await sendBreakoutBroadcast(req.params.roomId, authReq.user.id, req.body.message);
    res.json(result);
  }),
);

// --- Recording ------------------------------------------------------------

roomsRouter.post(
  "/:roomId/recording/start",
  asyncHandler(async (req, res) => {
    const authReq = req as AuthRequest;
    const recording = await startRecording(req.params.roomId, authReq.user.id);
    res.status(201).json(recording);
  }),
);

roomsRouter.post(
  "/:roomId/recording/stop",
  asyncHandler(async (req, res) => {
    const authReq = req as AuthRequest;
    const recording = await stopRecording(req.params.roomId, authReq.user.id);
    res.json(recording);
  }),
);

roomsRouter.get(
  "/:roomId/recording/status",
  asyncHandler(async (req, res) => {
    const recording = await getActiveRecording(req.params.roomId);
    res.json(recording);
  }),
);

// --- Polls & Q&A ---------------------------------------------------------

roomsRouter.get(
  "/:roomId/polls",
  asyncHandler(async (req, res) => {
    const polls = await listPolls(req.params.roomId);
    res.json(polls);
  }),
);

roomsRouter.post(
  "/:roomId/polls",
  validateBody(createPollSchema),
  asyncHandler(async (req, res) => {
    const authReq = req as AuthRequest;
    const poll = await createPoll(req.params.roomId, authReq.user.id, req.body);
    res.status(201).json(poll);
  }),
);

roomsRouter.post(
  "/:roomId/polls/:pollId/vote",
  validateBody(votePollSchema),
  asyncHandler(async (req, res) => {
    const authReq = req as AuthRequest;
    const poll = await votePoll(req.params.pollId, authReq.user.id, req.body.optionId);
    res.json(poll);
  }),
);

roomsRouter.post(
  "/:roomId/polls/:pollId/close",
  asyncHandler(async (req, res) => {
    const authReq = req as AuthRequest;
    const poll = await closePoll(req.params.pollId, authReq.user.id);
    res.json(poll);
  }),
);

roomsRouter.get(
  "/:roomId/questions",
  asyncHandler(async (req, res) => {
    const questions = await listQuestions(req.params.roomId);
    res.json(questions);
  }),
);

roomsRouter.post(
  "/:roomId/questions",
  validateBody(askQuestionSchema),
  asyncHandler(async (req, res) => {
    const authReq = req as AuthRequest;
    const question = await askQuestion(req.params.roomId, authReq.user.id, req.body.text);
    res.status(201).json(question);
  }),
);

roomsRouter.post(
  "/:roomId/questions/:questionId/upvote",
  asyncHandler(async (req, res) => {
    const authReq = req as AuthRequest;
    const question = await toggleUpvote(req.params.questionId, authReq.user.id);
    res.json(question);
  }),
);

roomsRouter.post(
  "/:roomId/questions/:questionId/answered",
  asyncHandler(async (req, res) => {
    const authReq = req as AuthRequest;
    const question = await markAnswered(req.params.questionId, authReq.user.id);
    res.json(question);
  }),
);
