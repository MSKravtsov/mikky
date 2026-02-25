-- =====================================================================
-- Gravity Claw — Supabase Migration
-- Run this in Supabase Dashboard > SQL Editor (or via supabase db push)
-- =====================================================================

-- Enable pgvector extension for semantic search
CREATE EXTENSION IF NOT EXISTS vector;

-- ─── Topics (LinkedIn planner) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS topics (
    id BIGSERIAL PRIMARY KEY,
    week_start TEXT NOT NULL,
    day_index INTEGER NOT NULL,
    topic TEXT NOT NULL,
    status TEXT DEFAULT 'draft',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ─── Templates (LinkedIn post templates) ─────────────────────────────
CREATE TABLE IF NOT EXISTS templates (
    id BIGSERIAL PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ─── Posts (generated LinkedIn posts) ────────────────────────────────
CREATE TABLE IF NOT EXISTS posts (
    id BIGSERIAL PRIMARY KEY,
    topic_id BIGINT REFERENCES topics(id),
    template_id BIGINT REFERENCES templates(id),
    content TEXT NOT NULL,
    delivered BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ─── Profile (user key-value profile) ────────────────────────────────
CREATE TABLE IF NOT EXISTS profile (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ─── Memories (core memory + evolution tracking) ─────────────────────
CREATE TABLE IF NOT EXISTS memories (
    id BIGSERIAL PRIMARY KEY,
    content TEXT NOT NULL,
    category TEXT DEFAULT 'general',
    embedding vector(1536),
    access_count INTEGER DEFAULT 0,
    last_accessed TIMESTAMPTZ DEFAULT now(),
    relevance REAL DEFAULT 1.0,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ─── Conversation Log ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS conversation_log (
    id BIGSERIAL PRIMARY KEY,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ─── LinkedIn Styles ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS linkedin_styles (
    id BIGSERIAL PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    style_guide TEXT NOT NULL,
    is_active BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ─── Knowledge Graph: Entities ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS entities (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    properties JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_entities_name_type ON entities(name, type);

-- ─── Knowledge Graph: Relationships ─────────────────────────────────
CREATE TABLE IF NOT EXISTS relationships (
    id BIGSERIAL PRIMARY KEY,
    from_id BIGINT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    to_id BIGINT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    properties JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rel_from ON relationships(from_id);
CREATE INDEX IF NOT EXISTS idx_rel_to ON relationships(to_id);

-- ─── Scheduled Tasks ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS scheduled_tasks (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    cron TEXT NOT NULL,
    prompt TEXT NOT NULL,
    enabled BOOLEAN DEFAULT true,
    last_run TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ─── Semantic Search Function (pgvector) ─────────────────────────────
CREATE OR REPLACE FUNCTION match_memories(
    query_embedding vector(1536),
    match_threshold FLOAT,
    match_count INT
)
RETURNS TABLE (
    id BIGINT,
    content TEXT,
    category TEXT,
    similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        m.id,
        m.content,
        m.category,
        1 - (m.embedding <=> query_embedding) AS similarity
    FROM memories m
    WHERE m.embedding IS NOT NULL
      AND 1 - (m.embedding <=> query_embedding) > match_threshold
    ORDER BY m.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

-- ─── Supabase Storage bucket for voice messages ─────────────────────
-- Create via Supabase Dashboard: Storage > New Bucket > "voice-messages"
-- Or run: INSERT INTO storage.buckets (id, name, public) VALUES ('voice-messages', 'voice-messages', true);

-- ─── Row Level Security (basic — service key bypasses RLS) ──────────
-- Enable RLS on all tables for defense-in-depth
ALTER TABLE topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE linkedin_styles ENABLE ROW LEVEL SECURITY;
ALTER TABLE entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_tasks ENABLE ROW LEVEL SECURITY;

-- Allow service_role full access (your bot uses SUPABASE_KEY = service_role key)
-- The service_role key bypasses RLS by default, so no explicit policies needed.
-- If using an anon key, you'd need to add policies here.
