import { registerTool } from "./index.js";
import { db } from "../db.js";

// ─── Tool: save_template ─────────────────────────────────────────────
registerTool({
    name: "save_template",
    description:
        "Saves a LinkedIn post template. The template can use placeholders like {{topic}}, {{hook}}, {{body}}, {{cta}}, {{hashtags}} which will be filled in when generating posts. If a template with the same name exists, it will be updated.",
    inputSchema: {
        type: "object" as const,
        properties: {
            name: {
                type: "string",
                description: 'Unique name for the template, e.g. "default" or "storytelling".',
            },
            content: {
                type: "string",
                description:
                    "The template text with placeholders like {{hook}}, {{body}}, etc.",
            },
        },
        required: ["name", "content"],
    },
    async execute(input: Record<string, unknown>): Promise<string> {
        const name = input.name as string;
        const content = input.content as string;

        db.prepare(
            `INSERT INTO templates (name, content) VALUES (?, ?)
       ON CONFLICT(name) DO UPDATE SET content = excluded.content`
        ).run(name, content);

        return JSON.stringify({
            success: true,
            message: `Template "${name}" saved successfully.`,
        });
    },
});

// ─── Tool: list_templates ────────────────────────────────────────────
registerTool({
    name: "list_templates",
    description: "Lists all saved LinkedIn post templates.",
    inputSchema: {
        type: "object" as const,
        properties: {},
        required: [],
    },
    async execute(): Promise<string> {
        const templates = db
            .prepare("SELECT id, name, content, created_at FROM templates ORDER BY name")
            .all() as Array<{
                id: number;
                name: string;
                content: string;
                created_at: string;
            }>;

        if (templates.length === 0) {
            return JSON.stringify({
                templates: [],
                message: "No templates saved yet. Ask the user to provide a post template.",
            });
        }

        return JSON.stringify({ templates });
    },
});

// ─── Tool: get_template ──────────────────────────────────────────────
registerTool({
    name: "get_template",
    description: "Retrieves a specific template by name.",
    inputSchema: {
        type: "object" as const,
        properties: {
            name: {
                type: "string",
                description: "Name of the template to retrieve.",
            },
        },
        required: ["name"],
    },
    async execute(input: Record<string, unknown>): Promise<string> {
        const name = input.name as string;

        const template = db
            .prepare("SELECT id, name, content FROM templates WHERE name = ?")
            .get(name) as { id: number; name: string; content: string } | undefined;

        if (!template) {
            return JSON.stringify({
                error: `Template "${name}" not found.`,
            });
        }

        return JSON.stringify({ template });
    },
});
