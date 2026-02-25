import { registerTool } from "./index.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MEMORY_DIR = process.env.NODE_ENV === "production"
    ? "/app/data/memory"
    : path.join(__dirname, "..", "..", "memory");

// Ensure memory directory exists
if (!fs.existsSync(MEMORY_DIR)) {
    fs.mkdirSync(MEMORY_DIR, { recursive: true });
}

// ─── Tool: save_note ─────────────────────────────────────────────────
registerTool({
    name: "save_note",
    description:
        "Save a markdown note to the local memory directory. Notes are human-readable .md files that persist across restarts. Use for structured information like meeting notes, project plans, reference docs.",
    inputSchema: {
        type: "object" as const,
        properties: {
            name: {
                type: "string",
                description:
                    'Filename without extension (e.g. "project-ideas", "meeting-2024-01").',
            },
            content: {
                type: "string",
                description: "Markdown content to save.",
            },
            append: {
                type: "boolean",
                description: "If true, append to existing file instead of overwriting.",
            },
        },
        required: ["name", "content"],
    },
    async execute(input: Record<string, unknown>): Promise<string> {
        const name = (input.name as string).replace(/[^a-zA-Z0-9_-]/g, "-");
        const content = input.content as string;
        const append = (input.append as boolean) || false;
        const filePath = path.join(MEMORY_DIR, `${name}.md`);

        if (append && fs.existsSync(filePath)) {
            fs.appendFileSync(filePath, `\n\n${content}`);
        } else {
            fs.writeFileSync(filePath, content);
        }

        return JSON.stringify({
            success: true,
            path: filePath,
            message: `Note "${name}.md" ${append ? "updated" : "saved"}.`,
        });
    },
});

// ─── Tool: read_note ─────────────────────────────────────────────────
registerTool({
    name: "read_note",
    description: "Read a markdown note from the memory directory.",
    inputSchema: {
        type: "object" as const,
        properties: {
            name: {
                type: "string",
                description: "Filename without extension.",
            },
        },
        required: ["name"],
    },
    async execute(input: Record<string, unknown>): Promise<string> {
        const name = (input.name as string).replace(/[^a-zA-Z0-9_-]/g, "-");
        const filePath = path.join(MEMORY_DIR, `${name}.md`);

        if (!fs.existsSync(filePath)) {
            return JSON.stringify({ error: `Note "${name}.md" not found.` });
        }

        const content = fs.readFileSync(filePath, "utf-8");
        return JSON.stringify({ name: `${name}.md`, content });
    },
});

// ─── Tool: list_notes ────────────────────────────────────────────────
registerTool({
    name: "list_notes",
    description: "List all markdown notes in the memory directory.",
    inputSchema: {
        type: "object" as const,
        properties: {},
        required: [],
    },
    async execute(): Promise<string> {
        const files = fs
            .readdirSync(MEMORY_DIR)
            .filter((f) => f.endsWith(".md"))
            .map((f) => {
                const stats = fs.statSync(path.join(MEMORY_DIR, f));
                return {
                    name: f,
                    size: `${(stats.size / 1024).toFixed(1)}KB`,
                    modified: stats.mtime.toISOString(),
                };
            });

        return JSON.stringify({
            directory: MEMORY_DIR,
            notes: files,
            count: files.length,
        });
    },
});

// ─── Tool: search_notes ──────────────────────────────────────────────
registerTool({
    name: "search_notes",
    description:
        "Search through all markdown notes for a text pattern (case-insensitive).",
    inputSchema: {
        type: "object" as const,
        properties: {
            query: { type: "string", description: "Text to search for." },
        },
        required: ["query"],
    },
    async execute(input: Record<string, unknown>): Promise<string> {
        const query = (input.query as string).toLowerCase();
        const results: Array<{ file: string; matches: string[] }> = [];

        const files = fs
            .readdirSync(MEMORY_DIR)
            .filter((f) => f.endsWith(".md"));

        for (const file of files) {
            const content = fs.readFileSync(path.join(MEMORY_DIR, file), "utf-8");
            const lines = content.split("\n");
            const matches = lines.filter((l) => l.toLowerCase().includes(query));
            if (matches.length > 0) {
                results.push({ file, matches: matches.slice(0, 5) });
            }
        }

        return JSON.stringify({ query, results, total_files_matched: results.length });
    },
});

// ─── Tool: delete_note ───────────────────────────────────────────────
registerTool({
    name: "delete_note",
    description: "Delete a markdown note from the memory directory.",
    inputSchema: {
        type: "object" as const,
        properties: {
            name: { type: "string", description: "Filename without extension." },
        },
        required: ["name"],
    },
    async execute(input: Record<string, unknown>): Promise<string> {
        const name = (input.name as string).replace(/[^a-zA-Z0-9_-]/g, "-");
        const filePath = path.join(MEMORY_DIR, `${name}.md`);

        if (!fs.existsSync(filePath)) {
            return JSON.stringify({ error: `Note "${name}.md" not found.` });
        }

        fs.unlinkSync(filePath);
        return JSON.stringify({ success: true, message: `Note "${name}.md" deleted.` });
    },
});
