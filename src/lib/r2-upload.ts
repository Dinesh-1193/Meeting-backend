import { randomUUID } from "crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { r2Config } from "../config/env";
import { AppError } from "../middleware/error-handler";

let client: S3Client | null = null;

function getClient(): S3Client {
  if (!r2Config) throw new AppError("File storage is not configured", 503);
  if (!client) {
    client = new S3Client({
      region: "auto",
      endpoint: r2Config.endpoint,
      credentials: {
        accessKeyId: r2Config.accessKeyId,
        secretAccessKey: r2Config.secretAccessKey,
      },
    });
  }
  return client;
}

/** Uploads a chat attachment to R2 and returns its public URL. */
export async function uploadChatAttachment(
  buffer: Buffer,
  originalFilename: string,
  contentType: string,
): Promise<string> {
  if (!r2Config) throw new AppError("File storage is not configured", 503);
  const safeName = originalFilename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100);
  const key = `chat-attachments/${randomUUID()}-${safeName}`;

  await getClient().send(
    new PutObjectCommand({
      Bucket: r2Config.bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    }),
  );

  const base = r2Config.publicUrl?.replace(/\/$/, "") ?? `${r2Config.endpoint}/${r2Config.bucket}`;
  return `${base}/${key}`;
}

/** Uploads a profile avatar to R2 and returns its public URL. */
export async function uploadAvatar(
  userId: string,
  buffer: Buffer,
  originalFilename: string,
  contentType: string,
): Promise<string> {
  if (!r2Config) throw new AppError("File storage is not configured", 503);
  const safeName = originalFilename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
  const key = `avatars/${userId}/${randomUUID()}-${safeName}`;

  await getClient().send(
    new PutObjectCommand({
      Bucket: r2Config.bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    }),
  );

  const base = r2Config.publicUrl?.replace(/\/$/, "") ?? `${r2Config.endpoint}/${r2Config.bucket}`;
  return `${base}/${key}`;
}
