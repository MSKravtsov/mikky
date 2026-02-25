import { registerTool } from "./index.js";

// ─── Supabase Memory Tools ──────────────────────────────────────────
// These tools connect to Supabase for cloud-synced semantic search.
// Requires SUPABASE_URL and SUPABASE_KEY in .env.
// Optional: OPENAI_API_KEY for embeddings.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const isConfigured = Boolean(SUPABASE_URL && SUPABASE_KEY);

if (!isConfigured) {
    console.log(
        "☁️ Supabase not configured (set SUPABASE_URL + SUPABASE_KEY to enable)"
    );
}

// ─── Embedding generation ────────────────────────────────────────────
async function getEmbedding(text: string): Promise<number[]> {
    if (!OPENAI_API_KEY) {
        throw new Error(
            "OPENAI_API_KEY required for embeddings. Set it in .env."
        );
    }

    const resp = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${OPENAI_API_KEY}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model: "text-embedding-3-small",
            input: text,
        }),
    });

    const data = (await resp.json()) as {
        data: Array<{ embedding: number[] }>;
    };
    return data.data[0]!.embedding;
}

// ─── Supabase helpers ────────────────────────────────────────────────
async function supabaseQuery(
    path: string,
    options: RequestInit = {}
): Promise<unknown> {
    if (!isConfigured)
        throw new Error("Supabase not configured.");

    const resp = await fetch(`${SUPABASE_URL}${path}`, {
        ...options,
        headers: {
            apikey: SUPABASE_KEY!,
            Authorization: `Bearer ${SUPABASE_KEY!}`,
            "Content-Type": "application/json",
            Prefer: "return=representation",
            ...((options.headers as Record<string, string>) || {}),
        },
    });

    if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`Supabase error: ${resp.status} ${text}`);
    }

    return resp.json();
}

// ─── Tool: sync_to_cloud ─────────────────────────────────────────────
registerTool({
    name: "sync_to_cloud",
    description:
        "Sync local memories to Supabase cloud storage with vector embeddings for semantic search. Requires Supabase to be configured.",
    inputSchema: {
        type: "object" as const,
        properties: {
            content: { type: "string", description: "Memory content to sync." },
            category: { type: "string", description: "Memory category." },
        },
        required: ["content"],
    },
    async execute(input: Record<string, unknown>): Promise<string> {
        if (!isConfigured) {
            return JSON.stringify({
                error:
                    "Supabase not configured. Set SUPABASE_URL and SUPABASE_KEY in .env.",
            });
        }

        const content = input.content as string;
        const category = (input.category as string) || "general";

        try {
            let embedding: number[] | null = null;
            if (OPENAI_API_KEY) {
                embedding = await getEmbedding(content);
            }

            const result = await supabaseQuery("/rest/v1/memories", {
                method: "POST",
                body: JSON.stringify({
                    content,
                    category,
                    embedding,
                }),
            });

            return JSON.stringify({
                success: true,
                message: "Memory synced to cloud.",
                has_embedding: Boolean(embedding),
            });
        } catch (err) {
            return JSON.stringify({
                error: `Sync failed: ${err instanceof Error ? err.message : String(err)}`,
            });
        }
    },
});

// ─── Tool: semantic_search ───────────────────────────────────────────
registerTool({
    name: "semantic_search",
    description:
        "Search memories by meaning using vector similarity (pgvector). Finds semantically related content even if the words are different. Requires Supabase + OpenAI.",
    inputSchema: {
        type: "object" as const,
        properties: {
            query: {
                type: "string",
                description: "Natural language search query.",
            },
            limit: { type: "number", description: "Max results (default: 5)." },
        },
        required: ["query"],
    },
    async execute(input: Record<string, unknown>): Promise<string> {
        if (!isConfigured || !OPENAI_API_KEY) {
            return JSON.stringify({
                error:
                    "Supabase + OpenAI required for semantic search. Set SUPABASE_URL, SUPABASE_KEY, and OPENAI_API_KEY in .env.",
            });
        }

        const query = input.query as string;
        const limit = (input.limit as number) || 5;

        try {
            const embedding = await getEmbedding(query);

            const result = await supabaseQuery("/rest/v1/rpc/match_memories", {
                method: "POST",
                body: JSON.stringify({
                    query_embedding: embedding,
                    match_threshold: 0.7,
                    match_count: limit,
                }),
            });

            return JSON.stringify({ query, results: result });
        } catch (err) {
            return JSON.stringify({
                error: `Semantic search failed: ${err instanceof Error ? err.message : String(err)}`,
            });
        }
    },
});
