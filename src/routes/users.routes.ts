import { Router } from "express";
import { requireAuth, requireRegisteredUser, type AuthRequest } from "../middleware/auth";
import { asyncHandler } from "../lib/async-handler";
import { listUserMeetings } from "../services/rooms.service";
import { AppError } from "../middleware/error-handler";

export const usersRouter = Router();

usersRouter.use(requireAuth, requireRegisteredUser);

usersRouter.get(
  "/:userId/meetings",
  asyncHandler(async (req, res) => {
    const authReq = req as AuthRequest;
    if (req.params.userId !== authReq.user.id) {
      throw new AppError("You can only list your own meetings", 403);
    }
    const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    res.json(await listUserMeetings(authReq.user.id, { cursor, limit }));
  }),
);
