// ─── Database layer — Supabase Postgres ─────────────────────────────
// Replaces the old SQLite (better-sqlite3) layer.
// Tables are created via Supabase migrations, not here.
// This module exports the shared supabase client and async helpers.

import { supabase } from "./supabase.js";

export { supabase };

// Re-export for convenience — modules that used to import { db } from "./db.js"
// now import { supabase } from "./db.js" (or from "./supabase.js" directly).

console.log("📦 Database layer ready (Supabase Postgres)");
