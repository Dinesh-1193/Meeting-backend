import { Router } from "express";
import { asyncHandler } from "../lib/async-handler";
import { supabaseAdmin } from "../lib/supabase";
import { webhookReceiver } from "../lib/livekit";
import { r2Config } from "../config/env";
import { mapEgressStatus } from "../services/recording.service";

export const webhooksRouter = Router();

webhooksRouter.post(
  "/livekit",
  asyncHandler(async (req, res) => {
    const rawBody: string = Buffer.isBuffer(req.body)
      ? req.body.toString("utf8")
      : typeof req.body === "string"
        ? req.body
        : "";

    let event;
    try {
      event = await webhookReceiver.receive(rawBody, req.headers.authorization);
    } catch {
      res.status(401).json({ message: "Invalid webhook signature" });
      return;
    }

    const roomId = event.room?.name;

    switch (event.event) {
      case "egress_started":
      case "egress_updated":
      case "egress_ended": {
        const egress = event.egressInfo;
        if (!egress?.egressId) break;

        const status = mapEgressStatus(egress.status) ?? (egress.error ? "failed" : "processing");

        const filename = egress.fileResults?.[0]?.filename;
        const url =
          status === "ready" && filename && r2Config?.publicUrl
            ? `${r2Config.publicUrl.replace(/\/$/, "")}/${filename}`
            : undefined;

        await supabaseAdmin
          .from("recordings")
          .update({
            status,
            ...(url ? { url } : {}),
            ...(status !== "processing" ? { ended_at: new Date().toISOString() } : {}),
            duration_seconds: egress.fileResults?.[0]?.duration
              ? Math.round(Number(egress.fileResults[0].duration) / 1_000_000_000)
              : undefined,
          })
          .eq("egress_id", egress.egressId);
        break;
      }

      case "participant_joined":
      case "participant_left": {
        if (!roomId || !event.participant?.identity) break;
        await supabaseAdmin
          .from("room_participants")
          .update(
            event.event === "participant_joined"
              ? { status: "joined", joined_at: new Date().toISOString() }
              : { status: "left", left_at: new Date().toISOString() },
          )
          .eq("room_id", roomId)
          .eq("user_id", event.participant.identity);
        break;
      }

      case "room_finished": {
        if (!roomId) break;
        await supabaseAdmin
          .from("rooms")
          .update({ status: "ended", ended_at: new Date().toISOString() })
          .eq("id", roomId)
          .neq("status", "ended");
        break;
      }

      default:
        break;
    }

    res.status(200).json({ ok: true });
  }),
);
