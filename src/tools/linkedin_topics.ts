import { registerTool } from "./index.js";
import { supabase } from "../supabase.js";

// ─── Helper: get Monday of the current or next week ──────────────────
function getWeekStart(nextWeek = false): string {
    const now = new Date();
    const day = now.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    const monday = new Date(now);
    monday.setDate(now.getDate() + diff + (nextWeek ? 7 : 0));
    return monday.toISOString().split("T")[0]!;
}

const DAY_NAMES = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
];

// ─── Tool: generate_weekly_topics ────────────────────────────────────
registerTool({
    name: "generate_weekly_topics",
    description:
        "Saves a list of 5 or 7 LinkedIn post topics for a week. Call this after suggesting topics to the user and they seem satisfied with the initial set. Each topic is saved as a draft that can be refined.",
    inputSchema: {
        type: "object" as const,
        properties: {
            topics: {
                type: "array",
                items: { type: "string" },
                description:
                    "Array of 5-7 topic strings, one per day (index 0=Monday).",
            },
            next_week: {
                type: "boolean",
                description:
                    "If true, schedule for next week. If false/omitted, schedule for this week.",
            },
        },
        required: ["topics"],
    },
    async execute(input: Record<string, unknown>): Promise<string> {
        const topics = input.topics as string[];
        const nextWeek = (input.next_week as boolean) || false;
        const weekStart = getWeekStart(nextWeek);

        if (topics.length < 5 || topics.length > 7) {
            return JSON.stringify({ error: "Provide between 5 and 7 topics." });
        }

        // Clear existing drafts for this week
        await supabase
            .from("topics")
            .delete()
            .eq("week_start", weekStart)
            .eq("status", "draft");

        // Insert new drafts
        const rows = topics.map((topic, i) => ({
            week_start: weekStart,
            day_index: i,
            topic,
            status: "draft",
        }));

        const { error } = await supabase.from("topics").insert(rows);

        if (error) {
            return JSON.stringify({ error: `Failed to save topics: ${error.message}` });
        }

        const summary = topics
            .map((t, i) => `${i + 1}. ${DAY_NAMES[i]}: ${t}`)
            .join("\n");

        return JSON.stringify({
            success: true,
            week_start: weekStart,
            count: topics.length,
            status: "draft",
            message: `Saved ${topics.length} topics as drafts for week of ${weekStart}:\n${summary}\n\nAsk the user to confirm or request changes.`,
        });
    },
});

// ─── Tool: update_topic ──────────────────────────────────────────────
registerTool({
    name: "update_topic",
    description:
        "Updates a specific day's topic. Use when the user wants to change one or more topics.",
    inputSchema: {
        type: "object" as const,
        properties: {
            day_index: {
                type: "number",
                description: "Day index: 0=Monday, 1=Tuesday, ..., 6=Sunday.",
            },
            new_topic: {
                type: "string",
                description: "The new topic text.",
            },
            week_start: {
                type: "string",
                description:
                    "ISO date of the week's Monday (optional — defaults to current/upcoming week).",
            },
        },
        required: ["day_index", "new_topic"],
    },
    async execute(input: Record<string, unknown>): Promise<string> {
        const dayIndex = input.day_index as number;
        const newTopic = input.new_topic as string;
        const weekStart = (input.week_start as string) || getWeekStart();

        if (dayIndex < 0 || dayIndex > 6) {
            return JSON.stringify({ error: "day_index must be 0-6." });
        }

        const { count, error } = await supabase
            .from("topics")
            .update({ topic: newTopic, updated_at: new Date().toISOString() })
            .eq("week_start", weekStart)
            .eq("day_index", dayIndex)
            .eq("status", "draft");

        if (error || !count) {
            return JSON.stringify({
                error: `No draft topic found for ${DAY_NAMES[dayIndex]} (week ${weekStart}). Generate topics first.`,
            });
        }

        return JSON.stringify({
            success: true,
            day: DAY_NAMES[dayIndex],
            new_topic: newTopic,
            message: `Updated ${DAY_NAMES[dayIndex]}'s topic to: "${newTopic}"`,
        });
    },
});

// ─── Tool: confirm_topics ────────────────────────────────────────────
registerTool({
    name: "confirm_topics",
    description:
        "Marks all draft topics for a week as confirmed. Call this when the user explicitly confirms they're happy with the topic list.",
    inputSchema: {
        type: "object" as const,
        properties: {
            week_start: {
                type: "string",
                description:
                    "ISO date of the week's Monday (optional — defaults to current/upcoming week).",
            },
        },
        required: [],
    },
    async execute(input: Record<string, unknown>): Promise<string> {
        const weekStart = (input.week_start as string) || getWeekStart();

        const { data: drafts } = await supabase
            .from("topics")
            .select("id, day_index, topic")
            .eq("week_start", weekStart)
            .eq("status", "draft");

        if (!drafts || drafts.length === 0) {
            return JSON.stringify({
                error: `No draft topics found for week ${weekStart}. Generate topics first.`,
            });
        }

        await supabase
            .from("topics")
            .update({ status: "confirmed", updated_at: new Date().toISOString() })
            .eq("week_start", weekStart)
            .eq("status", "draft");

        const summary = drafts
            .map((d: any) => `${DAY_NAMES[d.day_index]}: ${d.topic}`)
            .join("\n");

        return JSON.stringify({
            success: true,
            week_start: weekStart,
            confirmed_count: drafts.length,
            message: `✅ ${drafts.length} topics confirmed for week of ${weekStart}:\n${summary}\n\nPosts will be delivered each morning.`,
        });
    },
});

// ─── Tool: get_weekly_topics ─────────────────────────────────────────
registerTool({
    name: "get_weekly_topics",
    description:
        "Retrieves the current topics for a given week. Use to show the user their planned topics.",
    inputSchema: {
        type: "object" as const,
        properties: {
            week_start: {
                type: "string",
                description:
                    "ISO date of the week's Monday (optional — defaults to current week).",
            },
        },
        required: [],
    },
    async execute(input: Record<string, unknown>): Promise<string> {
        const weekStart = (input.week_start as string) || getWeekStart();

        const { data: topics } = await supabase
            .from("topics")
            .select("day_index, topic, status")
            .eq("week_start", weekStart)
            .order("day_index");

        if (!topics || topics.length === 0) {
            return JSON.stringify({
                week_start: weekStart,
                topics: [],
                message: "No topics found for this week.",
            });
        }

        const list = topics.map((t: any) => ({
            day: DAY_NAMES[t.day_index],
            topic: t.topic,
            status: t.status,
        }));

        return JSON.stringify({
            week_start: weekStart,
            topics: list,
        });
    },
});
