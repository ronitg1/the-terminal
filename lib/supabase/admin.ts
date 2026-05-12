import { createClient } from "@supabase/supabase-js";

// Service-role client. Server-only. Used by cron routes that bypass RLS.
let admin: ReturnType<typeof createClient> | undefined;

export function createAdminSupabase() {
  if (admin) return admin;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY for admin client");
  }
  admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return admin;
}
