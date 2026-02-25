// ─── Shared Supabase Client ──────────────────────────────────────────
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "./config.js";

export const supabase: SupabaseClient = createClient(
    config.supabaseUrl,
    config.supabaseKey
);

console.log("☁️  Supabase client ready");
