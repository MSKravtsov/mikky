import { registerTool } from "./index.js";
import { db } from "../db.js";

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

        const result = db
            .prepare("INSERT INTO memories (content, category) VALUES (?, ?)")
            .run(content, category);

        return JSON.stringify({
            success: true,
            id: result.lastInsertRowid,
            message: `Remembered: "${content}" [${category}]`,
        });
    },
});

// ─── Tool: search_memory ─────────────────────────────────────────────
registerTool({
    name: "search_memory",
    description:
        "Search through saved memories using full-text search. Use this to recall facts about the user, their preferences, past conversations, or any stored information.",
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

        // FTS5 query — add * for prefix matching
        const ftsQuery = query
            .split(/\s+/)
            .map((word) => `"${word}"*`)
            .join(" OR ");

        let sql: string;
        let params: unknown[];

        if (category) {
            sql = `
        SELECT m.id, m.content, m.category, m.created_at,
               rank
        FROM memories_fts fts
        JOIN memories m ON m.id = fts.rowid
        WHERE memories_fts MATCH ? AND m.category = ?
        ORDER BY rank
        LIMIT ?
      `;
            params = [ftsQuery, category, limit];
        } else {
            sql = `
        SELECT m.id, m.content, m.category, m.created_at,
               rank
        FROM memories_fts fts
        JOIN memories m ON m.id = fts.rowid
        WHERE memories_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `;
            params = [ftsQuery, limit];
        }

        try {
            const results = db.prepare(sql).all(...params) as Array<{
                id: number;
                content: string;
                category: string;
                created_at: string;
            }>;

            return JSON.stringify({
                query,
                results,
                count: results.length,
            });
        } catch {
            // Fallback to LIKE search if FTS query fails
            const likeResults = db
                .prepare(
                    "SELECT id, content, category, created_at FROM memories WHERE content LIKE ? LIMIT ?"
                )
                .all(`%${query}%`, limit) as Array<{
                    id: number;
                    content: string;
                    category: string;
                    created_at: string;
                }>;

            return JSON.stringify({
                query,
                results: likeResults,
                count: likeResults.length,
            });
        }
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

        let results;
        if (category) {
            results = db
                .prepare(
                    "SELECT id, content, category, created_at FROM memories WHERE category = ? ORDER BY created_at DESC LIMIT ?"
                )
                .all(category, limit);
        } else {
            results = db
                .prepare(
                    "SELECT id, content, category, created_at FROM memories ORDER BY created_at DESC LIMIT ?"
                )
                .all(limit);
        }

        return JSON.stringify({ memories: results, count: (results as unknown[]).length });
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

        const result = db
            .prepare("DELETE FROM memories WHERE id = ?")
            .run(id);

        if (result.changes === 0) {
            return JSON.stringify({ error: `No memory found with ID ${id}.` });
        }

        return JSON.stringify({
            success: true,
            message: `Memory #${id} forgotten.`,
        });
    },
});
