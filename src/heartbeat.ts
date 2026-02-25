import cron from "node-cron";
import { bot } from "./bot.js";
import { config } from "./config.js";
import { runAgent } from "./agent.js";
import { runMaintenance } from "./memory_evolution.js";

interface HeartbeatChecker {
    name: string;
    interval: string; // cron expression
    check: () => Promise<string | null>; // returns message if noteworthy, null otherwise
}

const checkers: HeartbeatChecker[] = [];
const activeJobs: cron.ScheduledTask[] = [];

// ─── Register a checker ──────────────────────────────────────────────
export function registerChecker(checker: HeartbeatChecker): void {
    checkers.push(checker);
}

// ─── Built-in checkers ───────────────────────────────────────────────

// Memory maintenance — runs daily at 3 AM
registerChecker({
    name: "memory-maintenance",
    interval: "0 3 * * *",
    async check() {
        const result = runMaintenance();
        if (result.duplicates > 0) {
            return `🧹 Memory maintenance: found ${result.duplicates} potential duplicate memories. Consider reviewing them.`;
        }
        return null; // Nothing noteworthy
    },
});

// ─── Notify user ─────────────────────────────────────────────────────
async function notifyUser(message: string): Promise<void> {
    for (const userId of config.allowedUserIds) {
        try {
            await bot.api.sendMessage(userId, message, { parse_mode: "Markdown" });
        } catch (err) {
            console.error(`❌ Heartbeat notification failed for ${userId}:`, err);
        }
    }
}

// ─── Morning briefing ────────────────────────────────────────────────
async function deliverMorningBriefing(): Promise<void> {
    console.log("🌅 Generating morning briefing...");
    try {
        const briefing = await runAgent(
            "Generate my morning briefing. Call get_weather and get_briefing to gather data, then compose a concise, friendly briefing message."
        );
        await notifyUser(`🌅 **Good Morning!**\n\n${briefing}`);
        console.log("   ✅ Morning briefing delivered");
    } catch (err) {
        console.error("   ❌ Morning briefing failed:", err);
    }
}

// ─── Start heartbeat system ──────────────────────────────────────────
export function startHeartbeat(): void {
    const timezone = process.env.POST_TIMEZONE || "Europe/Berlin";

    // Morning briefing
    const briefingTime = process.env.BRIEFING_TIME || "07:30";
    const [bH, bM] = briefingTime.split(":").map(Number);
    if (!isNaN(bH!) && !isNaN(bM!)) {
        const briefingJob = cron.schedule(
            `${bM} ${bH} * * 1-5`,
            deliverMorningBriefing,
            { timezone }
        );
        activeJobs.push(briefingJob);
        console.log(
            `🌅 Morning briefing: ${briefingTime} (${timezone}), Mon–Fri`
        );
    }

    // Register all checker cron jobs
    for (const checker of checkers) {
        const job = cron.schedule(
            checker.interval,
            async () => {
                try {
                    const result = await checker.check();
                    if (result) {
                        await notifyUser(result);
                        console.log(`💓 Heartbeat [${checker.name}]: notified user`);
                    }
                } catch (err) {
                    console.error(`❌ Heartbeat [${checker.name}] failed:`, err);
                }
            },
            { timezone }
        );
        activeJobs.push(job);
        console.log(`💓 Heartbeat checker: ${checker.name} (${checker.interval})`);
    }
}
