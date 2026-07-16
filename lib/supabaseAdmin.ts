import { createClient } from "@supabase/supabase-js";

export function createSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が設定されていません（.env.local を確認してください）"
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
  });
}
