import { Router } from "express";
import { requireAuth, requireRegisteredUser, type AuthRequest } from "../middleware/auth";
import { asyncHandler } from "../lib/async-handler";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "../services/notifications.service";
import { touchPresence } from "../services/auth.service";

export const notificationsRouter = Router();
export const presenceRouter = Router();

notificationsRouter.use(requireAuth, requireRegisteredUser);

notificationsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const authReq = req as AuthRequest;
    const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    res.json(await listNotifications(authReq.user.id, { cursor, limit }));
  }),
);

notificationsRouter.post(
  "/read-all",
  asyncHandler(async (req, res) => {
    await markAllNotificationsRead((req as AuthRequest).user.id);
    res.status(204).send();
  }),
);

notificationsRouter.post(
  "/:id/read",
  asyncHandler(async (req, res) => {
    await markNotificationRead((req as AuthRequest).user.id, req.params.id);
    res.status(204).send();
  }),
);

presenceRouter.use(requireAuth, requireRegisteredUser);

presenceRouter.post(
  "/heartbeat",
  asyncHandler(async (req, res) => {
    await touchPresence((req as AuthRequest).user.id);
    res.status(204).send();
  }),
);
