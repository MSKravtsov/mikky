import { registerTool } from "./index.js";
import { db } from "../db.js";

// ─── Tool: set_profile ───────────────────────────────────────────────
registerTool({
    name: "set_profile",
    description:
        "Set or update a user profile fact. Use this when you learn key information about the user: name, role, company, interests, expertise, communication style, etc. Common keys: name, role, company, industry, interests, expertise, tone, writing_style, location.",
    inputSchema: {
        type: "object" as const,
        properties: {
            key: {
                type: "string",
                description:
                    'Profile fact key (e.g. "name", "role", "interests", "expertise").',
            },
            value: {
                type: "string",
                description: "The value for this profile fact.",
            },
        },
        required: ["key", "value"],
    },
    async execute(input: Record<string, unknown>): Promise<string> {
        const key = (input.key as string).toLowerCase().trim();
        const value = input.value as string;

        db.prepare(
            `INSERT INTO profile (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
        ).run(key, value);

        return JSON.stringify({
            success: true,
            message: `Profile updated: ${key} = "${value}"`,
        });
    },
});

// ─── Tool: get_profile ───────────────────────────────────────────────
registerTool({
    name: "get_profile",
    description:
        "Get user profile facts. Call this at the start of important tasks (like generating LinkedIn topics) to understand the user's context.",
    inputSchema: {
        type: "object" as const,
        properties: {
            key: {
                type: "string",
                description:
                    "Optional specific key to retrieve. Omit to get all profile facts.",
            },
        },
        required: [],
    },
    async execute(input: Record<string, unknown>): Promise<string> {
        const key = input.key as string | undefined;

        if (key) {
            const row = db
                .prepare("SELECT key, value, updated_at FROM profile WHERE key = ?")
                .get(key) as { key: string; value: string; updated_at: string } | undefined;

            if (!row) {
                return JSON.stringify({ error: `No profile fact found for "${key}".` });
            }
            return JSON.stringify({ profile: row });
        }

        const rows = db
            .prepare("SELECT key, value, updated_at FROM profile ORDER BY key")
            .all() as Array<{ key: string; value: string; updated_at: string }>;

        if (rows.length === 0) {
            return JSON.stringify({
                profile: {},
                message:
                    "No profile information saved yet. Ask the user about themselves to build their profile.",
            });
        }

        // Convert to a clean object
        const profile: Record<string, string> = {};
        for (const row of rows) {
            profile[row.key] = row.value;
        }

        return JSON.stringify({ profile });
    },
});
