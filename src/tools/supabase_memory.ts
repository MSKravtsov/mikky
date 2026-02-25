import { registerTool } from "./index.js";
import { supabase } from "../supabase.js";

// ─── Supabase Memory Tools ──────────────────────────────────────────
// These tools use the shared Supabase client for cloud-synced semantic search.
// Requires SUPABASE_URL and SUPABASE_KEY (now required in config).
// Optional: OPENAI_API_KEY for embeddings.

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

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

// ─── Tool: sync_to_cloud ─────────────────────────────────────────────
registerTool({
    name: "sync_to_cloud",
    description:
        "Sync local memories to Supabase cloud storage with vector embeddings for semantic search.",
    inputSchema: {
        type: "object" as const,
        properties: {
            content: { type: "string", description: "Memory content to sync." },
            category: { type: "string", description: "Memory category." },
        },
        required: ["content"],
    },
    async execute(input: Record<string, unknown>): Promise<string> {
        const content = input.content as string;
        const category = (input.category as string) || "general";

        try {
            let embedding: number[] | null = null;
            if (OPENAI_API_KEY) {
                embedding = await getEmbedding(content);
            }

            const { error } = await supabase.from("memories").insert({
                content,
                category,
                embedding,
            });

            if (error) {
                return JSON.stringify({ error: `Sync failed: ${error.message}` });
            }

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
        "Search memories by meaning using vector similarity (pgvector). Finds semantically related content even if the words are different. Requires OpenAI API key for embeddings.",
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
        if (!OPENAI_API_KEY) {
            return JSON.stringify({
                error:
                    "OPENAI_API_KEY required for semantic search. Set it in .env.",
            });
        }

        const query = input.query as string;
        const limit = (input.limit as number) || 5;

        try {
            const embedding = await getEmbedding(query);

            const { data: result, error } = await supabase.rpc("match_memories", {
                query_embedding: embedding,
                match_threshold: 0.7,
                match_count: limit,
            });

            if (error) {
                return JSON.stringify({ error: `Semantic search failed: ${error.message}` });
            }

            return JSON.stringify({ query, results: result });
        } catch (err) {
            return JSON.stringify({
                error: `Semantic search failed: ${err instanceof Error ? err.message : String(err)}`,
            });
        }
    },
});
