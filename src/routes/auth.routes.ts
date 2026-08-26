import { Router } from "express";
import multer from "multer";
import {
  login,
  loginSchema,
  logout,
  signup,
  signupSchema,
  getMe,
  refreshSession,
  refreshSchema,
  updateProfile,
  updateProfileSchema,
  uploadUserAvatar,
  forgotPassword,
  forgotPasswordSchema,
  resetPassword,
  resetPasswordSchema,
  exchangeOAuthSession,
  oauthSessionSchema,
  createGuestSession,
  guestSchema,
} from "../services/auth.service";
import { requireAuth, requireRegisteredUser, type AuthRequest } from "../middleware/auth";
import { validateBody } from "../middleware/validate";
import { asyncHandler } from "../lib/async-handler";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

export const authRouter = Router();

authRouter.post(
  "/signup",
  validateBody(signupSchema),
  asyncHandler(async (req, res) => {
    const result = await signup(req.body);
    res.status(201).json(result);
  }),
);

authRouter.post(
  "/login",
  validateBody(loginSchema),
  asyncHandler(async (req, res) => {
    const result = await login(req.body);
    res.json(result);
  }),
);

authRouter.post(
  "/refresh",
  validateBody(refreshSchema),
  asyncHandler(async (req, res) => {
    const result = await refreshSession(req.body.refreshToken);
    res.json(result);
  }),
);

authRouter.post(
  "/logout",
  requireAuth,
  requireRegisteredUser,
  asyncHandler(async (req, res) => {
    await logout((req as AuthRequest).user.id);
    res.status(204).send();
  }),
);

authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const authReq = req as AuthRequest;
    if (authReq.isGuest) {
      res.json({
        id: authReq.user.id,
        email: authReq.user.email ?? "",
        name: (authReq.user.user_metadata?.name as string) || "Guest",
        isGuest: true,
      });
      return;
    }
    const user = await getMe(authReq.user.id);
    res.json(user);
  }),
);

authRouter.patch(
  "/me",
  requireAuth,
  requireRegisteredUser,
  validateBody(updateProfileSchema),
  asyncHandler(async (req, res) => {
    const user = await updateProfile((req as AuthRequest).user.id, req.body);
    res.json(user);
  }),
);

authRouter.post(
  "/me/avatar",
  requireAuth,
  requireRegisteredUser,
  upload.single("avatar"),
  asyncHandler(async (req, res) => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ message: "Avatar file is required" });
      return;
    }
    const user = await uploadUserAvatar((req as AuthRequest).user.id, file);
    res.json(user);
  }),
);

authRouter.post(
  "/forgot-password",
  validateBody(forgotPasswordSchema),
  asyncHandler(async (req, res) => {
    await forgotPassword(req.body.email);
    res.json({ ok: true });
  }),
);

authRouter.post(
  "/reset-password",
  validateBody(resetPasswordSchema),
  asyncHandler(async (req, res) => {
    await resetPassword(req.body);
    res.json({ ok: true });
  }),
);

authRouter.post(
  "/oauth/google",
  validateBody(oauthSessionSchema),
  asyncHandler(async (req, res) => {
    const result = await exchangeOAuthSession(req.body);
    res.json(result);
  }),
);

authRouter.post(
  "/guest",
  validateBody(guestSchema),
  asyncHandler(async (req, res) => {
    const result = await createGuestSession(req.body);
    res.status(201).json(result);
  }),
);
