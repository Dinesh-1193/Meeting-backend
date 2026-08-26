import { Router } from "express";
import { requireAuth, requireRegisteredUser, type AuthRequest } from "../middleware/auth";
import { validateBody } from "../middleware/validate";
import { asyncHandler } from "../lib/async-handler";
import {
  createTemplate,
  createTemplateSchema,
  deleteTemplate,
  listTemplates,
} from "../services/templates.service";

export const templatesRouter = Router();

templatesRouter.use(requireAuth, requireRegisteredUser);

templatesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const authReq = req as AuthRequest;
    const templates = await listTemplates(authReq.user.id);
    res.json(templates);
  }),
);

templatesRouter.post(
  "/",
  validateBody(createTemplateSchema),
  asyncHandler(async (req, res) => {
    const authReq = req as AuthRequest;
    const template = await createTemplate(authReq.user.id, req.body);
    res.status(201).json(template);
  }),
);

templatesRouter.delete(
  "/:templateId",
  asyncHandler(async (req, res) => {
    const authReq = req as AuthRequest;
    await deleteTemplate(authReq.user.id, req.params.templateId);
    res.status(204).send();
  }),
);
