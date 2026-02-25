import { registerTool } from "./index.js";
import { db } from "../db.js";

// ─── Andrew Ng default style (auto-seeded) ───────────────────────────
const ANDREW_NG_STYLE = `STYLE NAME: Andrew Ng — Warm Thought Leader

STRUCTURE:
- Use the "Hook → Insight → CTA" framework for every post.
- Open with a bold, one-line hook that stops the scroll (max 2 lines before "see more").
- Leave an empty line after the hook to force the "see more" click.
- Use very short paragraphs — one sentence per line.
- Use numbered lists (1️⃣, 2️⃣, etc.) for key insights (typically 3-5 points).
- Each numbered point has a bold header followed by a brief explanation.
- End with a single-line takeaway or reframe.
- Close with an open-ended engagement question + 👇 emoji.
- Add 3-5 relevant hashtags at the very end.

TONE:
- Warm, mentor-like, and inclusive. Like a respected professor sharing wisdom over coffee.
- Forward-looking and optimistic, but honest about challenges.
- Confident without being arrogant. Use "I believe" and "Here's what I've learned."
- Accessible — avoid jargon. If a concept is complex, simplify it with an analogy.
- Personal when possible — reference your own experience or perspective.

FORMATTING:
- Line break after every sentence.
- Moderate emoji use: numbered emojis (1️⃣-5️⃣) and a single 👇 at the end. No excessive emojis.
- Bold keywords and key phrases for scannability.
- No walls of text — if it looks dense, break it up.
- Keep total length to 150-250 words (sweet spot for engagement).

VIRAL FORMULAS TO ROTATE:
1. "I was wrong about..." (Vulnerability + Learning)
2. "Stop doing X, do Y instead" (Contrarian Advice)
3. "Here's what [complex thing] actually means" (Simplification)
4. "Behind the scenes of [achievement]" (Insider Story)
5. "The real reason [trend] is happening" (Framework Post)
6. "X years ago I [struggled]. Here's what happened." (Journey Arc)

RULES:
- The first 2 lines MUST create curiosity or tension (this triggers the "see more" click — LinkedIn's algorithm treats this as engagement).
- Never start with "I'm excited to announce" or "I'm thrilled" — these are LinkedIn clichés.
- Always end with a question that invites the audience to share their perspective.
- Save the strongest insight for last in numbered lists.
- When referencing a person's professional title or company, make it feel natural, not name-droppy.`;

// ─── Tool: get_linkedin_style ────────────────────────────────────────
registerTool({
    name: "get_linkedin_style",
    description:
        "Retrieves the currently active LinkedIn writing style guide. ALWAYS call this before writing any LinkedIn post. If no style exists, the Andrew Ng default will be auto-seeded.",
    inputSchema: {
        type: "object" as const,
        properties: {},
        required: [],
    },
    async execute(): Promise<string> {
        // Try to find active style
        let style = db
            .prepare(
                "SELECT id, name, style_guide FROM linkedin_styles WHERE is_active = 1 LIMIT 1"
            )
            .get() as
            | { id: number; name: string; style_guide: string }
            | undefined;

        // Auto-seed if table is empty
        if (!style) {
            const count = db
                .prepare("SELECT COUNT(*) as cnt FROM linkedin_styles")
                .get() as { cnt: number };

            if (count.cnt === 0) {
                db.prepare(
                    "INSERT INTO linkedin_styles (name, style_guide, is_active) VALUES (?, ?, 1)"
                ).run("andrew_ng", ANDREW_NG_STYLE);

                style = {
                    id: 1,
                    name: "andrew_ng",
                    style_guide: ANDREW_NG_STYLE,
                };
            }
        }

        if (!style) {
            return JSON.stringify({
                error: "No active style found. Save one with save_linkedin_style.",
            });
        }

        return JSON.stringify({
            name: style.name,
            style_guide: style.style_guide,
            instruction:
                "Apply this style naturally when writing the LinkedIn post. Internalize the patterns — don't copy the template verbatim.",
        });
    },
});

// ─── Tool: save_linkedin_style ───────────────────────────────────────
registerTool({
    name: "save_linkedin_style",
    description:
        "Saves a new LinkedIn writing style guide and sets it as the active style. If a style with the same name exists, it will be updated. Only one style can be active at a time.",
    inputSchema: {
        type: "object" as const,
        properties: {
            name: {
                type: "string",
                description:
                    'Short name for the style, e.g. "andrew_ng", "minimalist", "storyteller".',
            },
            style_guide: {
                type: "string",
                description:
                    "The full style guide text describing tone, structure, formatting rules, and examples.",
            },
            set_active: {
                type: "boolean",
                description:
                    "Whether to set this as the active style (default: true).",
            },
        },
        required: ["name", "style_guide"],
    },
    async execute(input: Record<string, unknown>): Promise<string> {
        const name = input.name as string;
        const styleGuide = input.style_guide as string;
        const setActive = (input.set_active as boolean) ?? true;

        // Upsert the style
        db.prepare(
            `INSERT INTO linkedin_styles (name, style_guide, is_active)
             VALUES (?, ?, ?)
             ON CONFLICT(name) DO UPDATE SET
               style_guide = excluded.style_guide,
               is_active = excluded.is_active,
               updated_at = datetime('now')`
        ).run(name, styleGuide, setActive ? 1 : 0);

        // If setting active, deactivate all others
        if (setActive) {
            db.prepare(
                "UPDATE linkedin_styles SET is_active = 0 WHERE name != ?"
            ).run(name);
        }

        return JSON.stringify({
            success: true,
            message: `Style "${name}" saved${setActive ? " and set as active" : ""}.`,
        });
    },
});

// ─── Tool: list_linkedin_styles ──────────────────────────────────────
registerTool({
    name: "list_linkedin_styles",
    description: "Lists all saved LinkedIn writing styles.",
    inputSchema: {
        type: "object" as const,
        properties: {},
        required: [],
    },
    async execute(): Promise<string> {
        const styles = db
            .prepare(
                "SELECT id, name, is_active, created_at FROM linkedin_styles ORDER BY name"
            )
            .all() as Array<{
                id: number;
                name: string;
                is_active: number;
                created_at: string;
            }>;

        if (styles.length === 0) {
            return JSON.stringify({
                styles: [],
                message: "No styles saved yet.",
            });
        }

        return JSON.stringify({
            styles: styles.map((s) => ({
                name: s.name,
                active: s.is_active === 1,
                created_at: s.created_at,
            })),
        });
    },
});
