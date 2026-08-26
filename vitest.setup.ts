process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://example.supabase.co";
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "anon-key-for-tests";
process.env.SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || "service-role-key-for-tests-16";
process.env.LIVEKIT_URL = process.env.LIVEKIT_URL || "wss://example.livekit.cloud";
process.env.LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || "APItest";
process.env.LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || "secret";
process.env.GUEST_JWT_SECRET = process.env.GUEST_JWT_SECRET || "test-guest-secret-key-32chars!!";
process.env.NODE_ENV = "test";
