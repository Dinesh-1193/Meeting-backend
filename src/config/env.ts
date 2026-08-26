import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  LIVEKIT_URL: z.string().min(1),
  LIVEKIT_API_KEY: z.string().min(1),
  LIVEKIT_API_SECRET: z.string().min(1),
  ENABLE_PERSONAL_ROOMS: z
    .string()
    .optional()
    .transform((v) => v !== "false"),
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  R2_PUBLIC_URL: z.string().optional(),
  CENTRIFUGO_API_URL: z.string().url().optional(),
  CENTRIFUGO_API_KEY: z.string().optional(),
  CENTRIFUGO_TOKEN_HMAC_SECRET: z.string().min(16).optional(),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional().default("MeetSpace <onboarding@resend.dev>"),
  APP_PUBLIC_URL: z.string().url().optional().default("http://localhost:3000"),
  GUEST_JWT_SECRET: z.string().min(16).optional(),
  SUPABASE_GOOGLE_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === "true"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

export const r2Config =
  env.R2_ACCOUNT_ID &&
  env.R2_ACCESS_KEY_ID &&
  env.R2_SECRET_ACCESS_KEY &&
  env.R2_BUCKET
    ? {
        accountId: env.R2_ACCOUNT_ID,
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
        bucket: env.R2_BUCKET,
        publicUrl: env.R2_PUBLIC_URL,
        endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      }
    : null;

export const centrifugoConfig =
  env.CENTRIFUGO_API_URL && env.CENTRIFUGO_API_KEY && env.CENTRIFUGO_TOKEN_HMAC_SECRET
    ? {
        apiUrl: env.CENTRIFUGO_API_URL,
        apiKey: env.CENTRIFUGO_API_KEY,
        hmacSecret: env.CENTRIFUGO_TOKEN_HMAC_SECRET,
      }
    : null;
