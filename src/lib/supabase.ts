import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { env } from "../config/env";

/** Untyped client — schema enforced in services + SQL migration. */
export type AppSupabase = SupabaseClient;

/** Service-role client — bypasses RLS. Server only. */
export const supabaseAdmin: AppSupabase = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  },
);

/** Anon client for password sign-in. */
export const supabaseAuth: AppSupabase = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_ANON_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  },
);

/** Request-scoped client that acts as the authenticated user. */
export function createUserClient(accessToken: string): AppSupabase {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export async function getUserFromToken(accessToken: string): Promise<User | null> {
  const { data, error } = await supabaseAdmin.auth.getUser(accessToken);
  if (error || !data.user) return null;
  return data.user;
}
