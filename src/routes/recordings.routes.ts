import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRegisteredUser, type AuthRequest } from "../middleware/auth";
import { validateBody } from "../middleware/validate";
import { asyncHandler } from "../lib/async-handler";
import { listAllRecordingsForUser } from "../services/workspace.service";
import { resolveRecordingShareUrl, setRecordingShareExpiry } from "../services/recording.service";
import { AppError } from "../middleware/error-handler";

// Unauthenticated on purpose — this is the link hosts copy and send to
// people outside the app, mirroring how the underlying R2 object is already
// publicly readable. Mounted before the authed router below so it's matched first.
export const recordingShareRouter = Router();

recordingShareRouter.get(
  "/:recordingId/share",
  asyncHandler(async (req, res) => {
    const url = await resolveRecordingShareUrl(req.params.recordingId);
    if (!url) throw new AppError("Recording not available", 404);
    res.redirect(302, url);
  }),
);

export const recordingsRouter = Router();

recordingsRouter.use(requireAuth, requireRegisteredUser);

recordingsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const authReq = req as AuthRequest;
    const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    res.json(await listAllRecordingsForUser(authReq.user.id, { cursor, limit }));
  }),
);

const shareExpirySchema = z.object({
  days: z.number().int().positive().max(365).nullable(),
});

recordingsRouter.patch(
  "/:recordingId/share",
  validateBody(shareExpirySchema),
  asyncHandler(async (req, res) => {
    const authReq = req as AuthRequest;
    const recording = await setRecordingShareExpiry(
      req.params.recordingId,
      authReq.user.id,
      req.body.days,
    );
    res.json(recording);
  }),
);
