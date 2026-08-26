import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRegisteredUser, type AuthRequest } from "../middleware/auth";
import { validateBody } from "../middleware/validate";
import { asyncHandler } from "../lib/async-handler";
import { addContact, listContacts } from "../services/workspace.service";

export const contactsRouter = Router();

contactsRouter.use(requireAuth, requireRegisteredUser);

contactsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const authReq = req as AuthRequest;
    const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const page = await listContacts(authReq.user.id, { cursor, limit });
    // Back-compat: clients that expect a bare array still work via `items`.
    res.json(page);
  }),
);
contactsRouter.post(
  "/",
  validateBody(
    z.object({
      email: z.string().email(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const authReq = req as AuthRequest;
    const contact = await addContact(authReq.user.id, req.body.email);
    res.status(201).json(contact);
  }),
);
