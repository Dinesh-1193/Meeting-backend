import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { env } from "./config/env";
import { authRouter } from "./routes/auth.routes";
import { roomsRouter } from "./routes/rooms.routes";
import { usersRouter } from "./routes/users.routes";
import { recordingShareRouter, recordingsRouter } from "./routes/recordings.routes";
import { contactsRouter } from "./routes/contacts.routes";
import { templatesRouter } from "./routes/templates.routes";
import { chatRouter } from "./routes/chat.routes";
import { webhooksRouter } from "./routes/webhooks.routes";
import {
  notificationsRouter,
  presenceRouter,
} from "./routes/notifications.routes";
import { errorHandler, notFound } from "./middleware/error-handler";

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGIN.split(",").map((o) => o.trim()),
      credentials: true,
    }),
  );
  // LiveKit webhook signature verification needs the raw body — must be
  // registered before the global JSON parser consumes the request stream.
  app.use("/webhooks", express.raw({ type: "*/*", limit: "2mb" }));
  app.use(express.json({ limit: "1mb" }));
  app.use(morgan(env.NODE_ENV === "production" ? "combined" : "dev"));

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      service: "meetspace-api",
      env: env.NODE_ENV,
      time: new Date().toISOString(),
    });
  });

  app.use("/auth", authRouter);
  app.use("/rooms", roomsRouter);
  app.use("/users", usersRouter);
  app.use("/recordings", recordingShareRouter);
  app.use("/recordings", recordingsRouter);
  app.use("/contacts", contactsRouter);
  app.use("/templates", templatesRouter);
  app.use("/chat", chatRouter);
  app.use("/notifications", notificationsRouter);
  app.use("/presence", presenceRouter);
  app.use("/webhooks", webhooksRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
