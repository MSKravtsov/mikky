import cron from "node-cron";
import { supabase } from "./supabase.js";
import { chat, type Message } from "./llm.js";
import { bot } from "./bot.js";
import { config } from "./config.js";
import { searchWeb, isSearchAvailable } from "./tools/web_search.js";

// ─── Fetch trending context for a topic ─────────────────────────────
async function fetchTrendingContext(topic: string): Promise<string> {
    if (!isSearchAvailable()) return "";

    console.log(`   🔍 Searching for trending content on: "${topic}"`);

    try {
        const { results } = await searchWeb(
            `latest trends news ${topic} ${new Date().getFullYear()}`,
            5
        );

        if (results.length === 0) return "";

        const trendingInfo = results
            .map((r, i) => `${i + 1}. ${r.title}\n   ${r.snippet.slice(0, 200)}`)
            .join("\n");

        return `\n\nRECENT TRENDING INFORMATION on this topic (use these to make the post timely and relevant):\n${trendingInfo}\n\nIncorporate 1-2 of these recent developments naturally into the post to make it current and insightful. Do NOT just list the news — weave it into your narrative.`;
    } catch (err) {
        console.error("   🔍 Trending search failed, writing without it.");
        return "";
    }
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

// ─── Get today's day index (0=Monday) ────────────────────────────────
function getTodayIndex(): number {
    const jsDay = new Date().getDay(); // 0=Sun
    return jsDay === 0 ? 6 : jsDay - 1; // Convert to 0=Mon
}

function getCurrentWeekStart(): string {
    const now = new Date();
    const day = now.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    const monday = new Date(now);
    monday.setDate(now.getDate() + diff);
    return monday.toISOString().split("T")[0]!;
}

// ─── Generate and deliver the daily LinkedIn post ────────────────────
async function deliverDailyPost(): Promise<void> {
    const todayIndex = getTodayIndex();
    const weekStart = getCurrentWeekStart();

    console.log(
        `📅 Scheduler: checking for ${DAY_NAMES[todayIndex]} post (week ${weekStart})`
    );

    // Get today's confirmed topic
    const { data: topic } = await supabase
        .from("topics")
        .select("id, topic")
        .eq("week_start", weekStart)
        .eq("day_index", todayIndex)
        .eq("status", "confirmed")
        .maybeSingle();

    if (!topic) {
        console.log("   No confirmed topic for today — skipping.");
        return;
    }

    // Get template (prefer "default", fall back to any)
    let { data: template } = await supabase
        .from("templates")
        .select("id, name, content")
        .eq("name", "default")
        .maybeSingle();

    if (!template) {
        const { data: fallback } = await supabase
            .from("templates")
            .select("id, name, content")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
        template = fallback;
    }

    // Load user profile for personalization
    const { data: profileRows } = await supabase
        .from("profile")
        .select("key, value")
        .order("key");

    let profileContext = "";
    if (profileRows && profileRows.length > 0) {
        profileContext = "\n\nAuthor profile:\n" +
            profileRows.map((r: any) => `- ${r.key}: ${r.value}`).join("\n") +
            "\n\nWrite in a voice that matches this person's expertise and style.";
    }

    // Build prompt for Claude
    const templateInstruction = template
        ? `Use this template structure:\n\n${template.content}\n\nFill in the placeholders based on the topic.`
        : `Write a professional LinkedIn post. Include a hook, main body, call-to-action, and relevant hashtags.`;

    // Search for trending content related to the topic
    const trendingContext = await fetchTrendingContext(topic.topic as string);

    const messages: Message[] = [
        {
            role: "user",
            content: `Write a LinkedIn post about: "${topic.topic}"\n\nDay: ${DAY_NAMES[todayIndex]}${profileContext}${trendingContext}\n\n${templateInstruction}\n\nReturn ONLY the final post text, ready to copy-paste to LinkedIn. No meta-commentary.`,
        },
    ];

    try {
        const response = await chat(messages, []);

        const textBlocks = response.content.filter(
            (block) => block.type === "text"
        );
        const postContent = textBlocks
            .map((b) => ("text" in b ? b.text : ""))
            .join("\n");

        if (!postContent) {
            console.error("   ❌ Empty response from LLM");
            return;
        }

        // Save the generated post
        await supabase.from("posts").insert({
            topic_id: topic.id,
            template_id: template?.id ?? null,
            content: postContent,
            delivered: true,
        });

        // Mark topic as posted
        await supabase
            .from("topics")
            .update({ status: "posted", updated_at: new Date().toISOString() })
            .eq("id", topic.id);

        // Send to user via Telegram
        const header = `📝 **LinkedIn Post — ${DAY_NAMES[todayIndex]}**\n_Topic: ${topic.topic}_\n\n---\n\n`;
        const fullMessage = header + postContent;

        for (const userId of config.allowedUserIds) {
            try {
                if (fullMessage.length <= 4096) {
                    await bot.api.sendMessage(userId, fullMessage, {
                        parse_mode: "Markdown",
                    });
                } else {
                    await bot.api.sendMessage(userId, header, {
                        parse_mode: "Markdown",
                    });
                    await bot.api.sendMessage(userId, postContent);
                }
            } catch (err) {
                console.error(`   ❌ Failed to send to user ${userId}:`, err);
            }
        }

        console.log(
            `   ✅ Post delivered (${postContent.length} chars) — topic: "${topic.topic}"`
        );
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("   ❌ Failed to generate post:", msg);
    }
}

// ─── Start the cron scheduler ────────────────────────────────────────
export function startScheduler(): void {
    const deliveryTime = process.env.POST_DELIVERY_TIME || "07:00";
    const timezone = process.env.POST_TIMEZONE || "Europe/Berlin";

    const [hours, minutes] = deliveryTime.split(":").map(Number);

    if (isNaN(hours!) || isNaN(minutes!)) {
        console.error(
            `❌ Invalid POST_DELIVERY_TIME: "${deliveryTime}". Use HH:MM format.`
        );
        return;
    }

    const cronExpression = `${minutes} ${hours} * * 1-5`;

    cron.schedule(cronExpression, deliverDailyPost, { timezone });

    console.log(
        `⏰ Scheduler: LinkedIn posts at ${deliveryTime} (${timezone}), Mon–Fri`
    );
}
