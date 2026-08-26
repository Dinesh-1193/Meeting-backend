import {
  EgressStatus,
  EncodedFileOutput,
  EncodedFileType,
  S3Upload,
  type EgressInfo,
} from "@livekit/protocol";
import { supabaseAdmin } from "../lib/supabase";
import { egressClient } from "../lib/livekit";
import { AppError } from "../middleware/error-handler";
import { r2Config } from "../config/env";
import { assertHost } from "../lib/authorization";
import { mapRecording } from "../lib/mappers";
import type { ApiRecording } from "../types/api";
import type { RecordingRow } from "../types/database";

export function mapEgressStatus(status: EgressStatus): RecordingRow["status"] | null {
  switch (status) {
    case EgressStatus.EGRESS_COMPLETE:
      return "ready";
    case EgressStatus.EGRESS_FAILED:
    case EgressStatus.EGRESS_ABORTED:
      return "failed";
    case EgressStatus.EGRESS_STARTING:
    case EgressStatus.EGRESS_ACTIVE:
    case EgressStatus.EGRESS_ENDING:
      return "processing";
    default:
      return null;
  }
}

/**
 * Reconciles a recording row against LiveKit's authoritative egress state.
 * This is what actually flips "processing" → "ready"/"failed" — the LiveKit
 * webhook does the same, but webhooks can't reach localhost during dev, so
 * every stop/status call also self-heals here instead of depending on it.
 */
async function syncRecordingFromEgress(
  row: RecordingRow,
  info: EgressInfo,
): Promise<RecordingRow> {
  const status = mapEgressStatus(info.status) ?? row.status;
  // Single-file room-composite egresses land in the deprecated `result.file`
  // oneof, not the newer `fileResults[]` array — check both or the URL/duration
  // silently stay null even though the recording completed successfully.
  const fileInfo =
    info.fileResults?.[0] ?? (info.result?.case === "file" ? info.result.value : undefined);
  const filename = fileInfo?.filename;
  const url =
    status === "ready" && filename && r2Config?.publicUrl
      ? `${r2Config.publicUrl.replace(/\/$/, "")}/${filename}`
      : row.url;
  const durationSeconds = fileInfo?.duration
    ? Math.round(Number(fileInfo.duration) / 1_000_000_000)
    : row.duration_seconds;

  if (status === row.status && url === row.url && durationSeconds === row.duration_seconds) {
    return row;
  }

  const { data, error } = await supabaseAdmin
    .from("recordings")
    .update({
      status,
      ...(url ? { url } : {}),
      ...(durationSeconds != null ? { duration_seconds: durationSeconds } : {}),
      ...(status !== "processing" ? { ended_at: new Date().toISOString() } : {}),
    })
    .eq("id", row.id)
    .select("*")
    .single();

  if (error || !data) return row;
  const updated = data as RecordingRow;
  if (row.status !== "ready" && updated.status === "ready") {
    void notifyRecordingReady(updated);
  }
  return updated;
}

async function notifyRecordingReady(row: RecordingRow): Promise<void> {
  try {
    const { createNotification } = await import("./notifications.service");
    const { data: room } = await supabaseAdmin
      .from("rooms")
      .select("name, host_id")
      .eq("id", row.room_id)
      .maybeSingle();
    if (!room) return;
    const r = room as { name: string; host_id: string };
    await createNotification({
      userId: r.host_id,
      type: "recording_ready",
      title: "Recording ready",
      body: `${r.name} is ready to watch`,
      href: "/dashboard/recordings",
    });
  } catch (err) {
    console.warn("[recording] notify failed", err);
  }
}

export async function startRecording(
  roomId: string,
  hostId: string,
): Promise<ApiRecording> {
  if (!r2Config) {
    throw new AppError(
      "Recording storage is not configured yet — set the R2_* environment variables",
      503,
    );
  }

  const room = await assertHost(roomId, hostId);

  const { data: active } = await supabaseAdmin
    .from("recordings")
    .select("*")
    .eq("room_id", room.id)
    .eq("status", "processing")
    .maybeSingle();
  if (active) {
    return mapRecording(active as RecordingRow);
  }

  const filepath = `recordings/${room.id}-${Date.now()}.mp4`;
  const output = new EncodedFileOutput({
    fileType: EncodedFileType.MP4,
    filepath,
    output: {
      case: "s3",
      value: new S3Upload({
        accessKey: r2Config.accessKeyId,
        secret: r2Config.secretAccessKey,
        bucket: r2Config.bucket,
        region: "auto",
        endpoint: r2Config.endpoint,
        forcePathStyle: true,
      }),
    },
  });

  const egressInfo = await egressClient.startRoomCompositeEgress(
    room.id,
    { file: output },
    { layout: "grid" },
  );

  const { data, error } = await supabaseAdmin
    .from("recordings")
    .insert({
      room_id: room.id,
      status: "processing",
      egress_id: egressInfo.egressId,
      started_at: new Date().toISOString(),
      requested_by: hostId,
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new AppError(error?.message ?? "Could not start recording", 500);
  }
  return mapRecording(data as RecordingRow);
}

export async function stopRecording(
  roomId: string,
  hostId: string,
): Promise<ApiRecording> {
  const room = await assertHost(roomId, hostId);

  const { data: active, error } = await supabaseAdmin
    .from("recordings")
    .select("*")
    .eq("room_id", room.id)
    .eq("status", "processing")
    .maybeSingle();

  if (error) throw new AppError(error.message, 500);
  const row = active as RecordingRow | null;
  if (!row?.egress_id) {
    throw new AppError("No recording is currently in progress", 404);
  }

  const info = await egressClient.stopEgress(row.egress_id);
  const updated = await syncRecordingFromEgress(row, info);
  return mapRecording(updated);
}

// Beyond this age, an egress LiveKit no longer knows about can never resolve
// on its own — stop it from hanging as "processing" forever.
const STALE_EGRESS_MS = 24 * 3_600_000;

async function reconcileOne(row: RecordingRow): Promise<RecordingRow> {
  // Also re-check "ready" rows with no URL yet — they finished before R2_PUBLIC_URL
  // was configured, so the one-time backfill on status change never ran for them.
  const needsSync =
    row.status === "processing" || (row.status === "ready" && !row.url);
  if (!needsSync || !row.egress_id) return row;

  try {
    const results = await egressClient.listEgress({ egressId: row.egress_id });
    const info = results[0];
    if (info) return await syncRecordingFromEgress(row, info);

    if (row.status !== "processing") return row;
    const startedAt = row.started_at ? new Date(row.started_at).getTime() : 0;
    if (startedAt && Date.now() - startedAt > STALE_EGRESS_MS) {
      const { data } = await supabaseAdmin
        .from("recordings")
        .update({ status: "failed", ended_at: new Date().toISOString() })
        .eq("id", row.id)
        .select("*")
        .single();
      if (data) return data as RecordingRow;
    }
    return row;
  } catch {
    // LiveKit lookup failed transiently — return the last known state.
    return row;
  }
}

/** Self-heals any "processing" rows against LiveKit before a list view renders them. */
export async function reconcileProcessingRecordings(
  rows: RecordingRow[],
): Promise<RecordingRow[]> {
  return Promise.all(rows.map((row) => reconcileOne(row)));
}

export async function setRecordingShareExpiry(
  recordingId: string,
  hostId: string,
  days: number | null,
): Promise<ApiRecording> {
  const { data: recRow, error: fetchErr } = await supabaseAdmin
    .from("recordings")
    .select("*")
    .eq("id", recordingId)
    .maybeSingle();
  if (fetchErr) throw new AppError(fetchErr.message, 500);
  const row = recRow as RecordingRow | null;
  if (!row) throw new AppError("Recording not found", 404);

  await assertHost(row.room_id, hostId);

  const shareExpiresAt = days ? new Date(Date.now() + days * 86_400_000).toISOString() : null;
  const { data, error } = await supabaseAdmin
    .from("recordings")
    .update({ share_expires_at: shareExpiresAt })
    .eq("id", recordingId)
    .select("*")
    .single();
  if (error || !data) {
    throw new AppError(error?.message ?? "Could not update share expiry", 500);
  }
  return mapRecording(data as RecordingRow);
}

/** Resolves a recording's share link to its underlying file URL, enforcing expiry. Used by the public share-redirect route. */
export async function resolveRecordingShareUrl(recordingId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("recordings")
    .select("*")
    .eq("id", recordingId)
    .maybeSingle();
  if (error) throw new AppError(error.message, 500);
  const row = data as RecordingRow | null;
  if (!row || row.status !== "ready" || !row.url) return null;

  if (row.share_expires_at && new Date(row.share_expires_at).getTime() < Date.now()) {
    throw new AppError("This share link has expired", 410);
  }
  return row.url;
}

export async function getActiveRecording(
  roomId: string,
): Promise<ApiRecording | null> {
  const { data, error } = await supabaseAdmin
    .from("recordings")
    .select("*")
    .eq("room_id", roomId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new AppError(error.message, 500);
  if (!data) return null;

  const row = await reconcileOne(data as RecordingRow);
  return mapRecording(row);
}
