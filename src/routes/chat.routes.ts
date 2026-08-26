import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { requireAuth, requireRegisteredUser, type AuthRequest } from "../middleware/auth";
import { validateBody } from "../middleware/validate";
import { asyncHandler } from "../lib/async-handler";
import {
  addAttachment,
  assertChannelMember,
  createGroupChannel,
  deleteMessage,
  editMessage,
  getChatStorageStatus,
  getOrCreateDirectChannel,
  leaveChannel,
  listChannelMembers,
  listChannelMessages,
  listConversations,
  markChannelRead,
  publishTyping,
  renameChannel,
  searchChannelMessages,
  sendMessage,
  setMuted,
  setPinned,
  toggleReaction,
} from "../services/chat.service";
import { mintConnectionToken, mintSubscriptionToken } from "../lib/centrifugo";
import { AppError } from "../middleware/error-handler";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

export const chatRouter = Router();

chatRouter.use(requireAuth, requireRegisteredUser);

chatRouter.get(
  "/status",
  asyncHandler(async (_req, res) => {
    res.json(await getChatStorageStatus());
  }),
);

chatRouter.get(
  "/conversations",
  asyncHandler(async (req, res) => {
    const authReq = req as AuthRequest;
    res.json(await listConversations(authReq.user.id));
  }),
);

chatRouter.post(
  "/dm",
  validateBody(z.object({ userId: z.string().uuid() })),
  asyncHandler(async (req, res) => {
    const authReq = req as AuthRequest;
    res.status(201).json(await getOrCreateDirectChannel(authReq.user.id, req.body.userId));
  }),
);

chatRouter.post(
  "/groups",
  validateBody(
    z.object({
      name: z.string().trim().min(1).max(120).optional(),
      memberUserIds: z.array(z.string().uuid()).min(1).max(49),
    }),
  ),
  asyncHandler(async (req, res) => {
    const authReq = req as AuthRequest;
    res
      .status(201)
      .json(
        await createGroupChannel(authReq.user.id, req.body.name ?? null, req.body.memberUserIds),
      );
  }),
);

chatRouter.get(
  "/channels/:channelId/messages",
  asyncHandler(async (req, res) => {
    const authReq = req as AuthRequest;
    const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    res.json(await listChannelMessages(authReq.user.id, req.params.channelId, { cursor, limit }));
  }),
);

chatRouter.get(
  "/channels/:channelId/search",
  asyncHandler(async (req, res) => {
    const authReq = req as AuthRequest;
    const q = typeof req.query.q === "string" ? req.query.q : "";
    res.json(await searchChannelMessages(authReq.user.id, req.params.channelId, q));
  }),
);

chatRouter.get(
  "/channels/:channelId/members",
  asyncHandler(async (req, res) => {
    const authReq = req as AuthRequest;
    res.json(await listChannelMembers(authReq.user.id, req.params.channelId));
  }),
);

chatRouter.patch(
  "/channels/:channelId",
  validateBody(z.object({ name: z.string().trim().min(1).max(120) })),
  asyncHandler(async (req, res) => {
    const authReq = req as AuthRequest;
    res.json(await renameChannel(authReq.user.id, req.params.channelId, req.body.name));
  }),
);

chatRouter.post(
  "/channels/:channelId/messages",
  validateBody(
    z.object({
      body: z.string().trim().min(1).max(4000),
      replyToMessageId: z.string().uuid().optional(),
      forwardedFromSenderName: z.string().trim().min(1).max(120).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const authReq = req as AuthRequest;
    res.status(201).json(
      await sendMessage(authReq.user.id, req.params.channelId, req.body.body, {
        replyToMessageId: req.body.replyToMessageId,
        forwardedFromSenderName: req.body.forwardedFromSenderName,
      }),
    );
  }),
);

chatRouter.patch(
  "/channels/:channelId/messages/:messageId",
  validateBody(z.object({ body: z.string().trim().min(1).max(4000) })),
  asyncHandler(async (req, res) => {
    const authReq = req as AuthRequest;
    res.json(
      await editMessage(authReq.user.id, req.params.channelId, req.params.messageId, req.body.body),
    );
  }),
);

chatRouter.delete(
  "/channels/:channelId/messages/:messageId",
  asyncHandler(async (req, res) => {
    const authReq = req as AuthRequest;
    res.json(
      await deleteMessage(authReq.user.id, req.params.channelId, req.params.messageId),
    );
  }),
);

chatRouter.post(
  "/channels/:channelId/messages/:messageId/reactions",
  validateBody(z.object({ emoji: z.string().trim().min(1).max(8) })),
  asyncHandler(async (req, res) => {
    const authReq = req as AuthRequest;
    const reactions = await toggleReaction(
      authReq.user.id,
      req.params.channelId,
      req.params.messageId,
      req.body.emoji,
    );
    res.json({ reactions });
  }),
);

chatRouter.post(
  "/channels/:channelId/attachments",
  upload.single("file"),
  asyncHandler(async (req, res) => {
    const authReq = req as AuthRequest;
    if (!req.file) throw new AppError("No file uploaded", 400);
    const caption = typeof req.body?.body === "string" ? req.body.body : undefined;
    const replyToMessageId =
      typeof req.body?.replyToMessageId === "string" ? req.body.replyToMessageId : undefined;
    res.status(201).json(
      await addAttachment(
        authReq.user.id,
        req.params.channelId,
        {
          buffer: req.file.buffer,
          originalname: req.file.originalname,
          mimetype: req.file.mimetype,
          size: req.file.size,
        },
        caption,
        replyToMessageId,
      ),
    );
  }),
);

chatRouter.post(
  "/channels/:channelId/typing",
  asyncHandler(async (req, res) => {
    const authReq = req as AuthRequest;
    await publishTyping(authReq.user.id, req.params.channelId);
    res.status(204).send();
  }),
);

chatRouter.post(
  "/channels/:channelId/read",
  asyncHandler(async (req, res) => {
    const authReq = req as AuthRequest;
    await markChannelRead(authReq.user.id, req.params.channelId);
    res.status(204).send();
  }),
);

chatRouter.post(
  "/channels/:channelId/mute",
  validateBody(z.object({ muted: z.boolean() })),
  asyncHandler(async (req, res) => {
    const authReq = req as AuthRequest;
    await setMuted(authReq.user.id, req.params.channelId, req.body.muted);
    res.status(204).send();
  }),
);

chatRouter.post(
  "/channels/:channelId/pin",
  validateBody(z.object({ pinned: z.boolean() })),
  asyncHandler(async (req, res) => {
    const authReq = req as AuthRequest;
    await setPinned(authReq.user.id, req.params.channelId, req.body.pinned);
    res.status(204).send();
  }),
);

chatRouter.delete(
  "/channels/:channelId",
  asyncHandler(async (req, res) => {
    const authReq = req as AuthRequest;
    await leaveChannel(authReq.user.id, req.params.channelId);
    res.status(204).send();
  }),
);

chatRouter.post(
  "/realtime/connection-token",
  asyncHandler(async (req, res) => {
    const authReq = req as AuthRequest;
    res.json({ token: mintConnectionToken(authReq.user.id) });
  }),
);

chatRouter.post(
  "/realtime/subscription-token",
  validateBody(z.object({ channel: z.string().min(1) })),
  asyncHandler(async (req, res) => {
    const authReq = req as AuthRequest;
    const match = /^\$chat:([0-9a-f-]{36})$/.exec(req.body.channel);
    if (!match) throw new AppError("Invalid channel", 400);
    await assertChannelMember(match[1], authReq.user.id);
    res.json({
      token: mintSubscriptionToken({ channel: req.body.channel, userId: authReq.user.id }),
    });
  }),
);
