import { registerTool } from "./index.js";
import { supabase } from "../supabase.js";

// Escape special Postgres LIKE characters to prevent pattern injection
function sanitizeLike(input: string): string {
    return input.replace(/[%_\\]/g, (c) => `\\${c}`);
}

function wordOverlap(a: string, b: string): number {
    const wordsA = new Set(a.toLowerCase().split(/\s+/));
    const wordsB = new Set(b.toLowerCase().split(/\s+/));
    const intersection = new Set([...wordsA].filter((w) => wordsB.has(w)));
    const union = new Set([...wordsA, ...wordsB]);
    return union.size === 0 ? 0 : intersection.size / union.size;
}

// ─── Tool: remember ──────────────────────────────────────────────────
registerTool({
    name: "remember",
    description:
        "Save an important fact, preference, or observation to long-term memory. Call this proactively whenever you learn something important about the user — their interests, preferences, projects, opinions, or any fact worth remembering later. Categories: professional, personal, preference, style, general.",
    inputSchema: {
        type: "object" as const,
        properties: {
            content: {
                type: "string",
                description: "The fact or observation to remember.",
            },
            category: {
                type: "string",
                enum: ["professional", "personal", "preference", "style", "general"],
                description: "Category for organizing the memory.",
            },
        },
        required: ["content"],
    },
    async execute(input: Record<string, unknown>): Promise<string> {
        const content = input.content as string;
        const category = (input.category as string) || "general";

        // Check for duplicates before inserting
        const { data: existing } = await supabase
            .from("memories")
            .select("id, content")
            .eq("category", category);

        if (existing && existing.length > 0) {
            for (const mem of existing) {
                const sim = wordOverlap(content, mem.content as string);
                if (sim > 0.7) {
                    // Update the existing memory instead of creating a duplicate
                    const { error } = await supabase
                        .from("memories")
                        .update({ content, last_accessed: new Date().toISOString() })
                        .eq("id", mem.id);

                    if (error) {
                        return JSON.stringify({ error: `Failed to update memory: ${error.message}` });
                    }

                    return JSON.stringify({
                        success: true,
                        id: mem.id,
                        message: `Updated existing memory #${mem.id} (${Math.round(sim * 100)}% similar) [${category}]`,
                    });
                }
            }
        }

        const { data, error } = await supabase
            .from("memories")
            .insert({ content, category })
            .select("id")
            .single();

        if (error) {
            return JSON.stringify({ error: `Failed to save memory: ${error.message}` });
        }

        return JSON.stringify({
            success: true,
            id: data.id,
            message: `Remembered: "${content}" [${category}]`,
        });
    },
});

// ─── Tool: search_memory ─────────────────────────────────────────────
registerTool({
    name: "search_memory",
    description:
        "Search through saved memories using text search. Use this to recall facts about the user, their preferences, past conversations, or any stored information.",
    inputSchema: {
        type: "object" as const,
        properties: {
            query: {
                type: "string",
                description: "Search query (supports natural language).",
            },
            category: {
                type: "string",
                description: "Optional category filter.",
            },
            limit: {
                type: "number",
                description: "Max results to return (default: 10).",
            },
        },
        required: ["query"],
    },
    async execute(input: Record<string, unknown>): Promise<string> {
        const query = input.query as string;
        const category = input.category as string | undefined;
        const limit = (input.limit as number) || 10;

        // Use Postgres text search with ilike as fallback
        let q = supabase
            .from("memories")
            .select("id, content, category, created_at")
            .ilike("content", `%${sanitizeLike(query)}%`)
            .order("created_at", { ascending: false })
            .limit(limit);

        if (category) {
            q = q.eq("category", category);
        }

        const { data: results, error } = await q;

        if (error) {
            return JSON.stringify({ error: `Search failed: ${error.message}` });
        }

        return JSON.stringify({
            query,
            results: results ?? [],
            count: results?.length ?? 0,
        });
    },
});

// ─── Tool: list_memories ─────────────────────────────────────────────
registerTool({
    name: "list_memories",
    description:
        "List recent memories, optionally filtered by category. Use when the user asks what you know or remember.",
    inputSchema: {
        type: "object" as const,
        properties: {
            category: {
                type: "string",
                description: "Optional category filter.",
            },
            limit: {
                type: "number",
                description: "Max results (default: 20).",
            },
        },
        required: [],
    },
    async execute(input: Record<string, unknown>): Promise<string> {
        const category = input.category as string | undefined;
        const limit = (input.limit as number) || 20;

        let q = supabase
            .from("memories")
            .select("id, content, category, created_at")
            .order("created_at", { ascending: false })
            .limit(limit);

        if (category) {
            q = q.eq("category", category);
        }

        const { data: results } = await q;

        return JSON.stringify({
            memories: results ?? [],
            count: results?.length ?? 0,
        });
    },
});

// ─── Tool: forget ────────────────────────────────────────────────────
registerTool({
    name: "forget",
    description:
        "Delete a specific memory by ID. Use when the user asks to forget something or when information is outdated.",
    inputSchema: {
        type: "object" as const,
        properties: {
            id: {
                type: "number",
                description: "The memory ID to delete.",
            },
        },
        required: ["id"],
    },
    async execute(input: Record<string, unknown>): Promise<string> {
        const id = input.id as number;

        const { error, count } = await supabase
            .from("memories")
            .delete({ count: "exact" })
            .eq("id", id);

        if (error || count === 0) {
            return JSON.stringify({ error: `No memory found with ID ${id}.` });
        }

        return JSON.stringify({
            success: true,
            message: `Memory #${id} forgotten.`,
        });
    },
});
