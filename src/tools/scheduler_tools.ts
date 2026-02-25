import { registerTool } from "./index.js";
import { db } from "../db.js";
import cron from "node-cron";
import { runAgent } from "../agent.js";
import { bot } from "../bot.js";
import { config } from "../config.js";

// ─── Schema for scheduled tasks ──────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS scheduled_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    cron TEXT NOT NULL,
    prompt TEXT NOT NULL,
    enabled INTEGER DEFAULT 1,
    last_run TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// ─── Active task jobs ────────────────────────────────────────────────
const activeTaskJobs = new Map<number, cron.ScheduledTask>();

// ─── Helper: send to user ────────────────────────────────────────────
async function sendToUser(message: string): Promise<void> {
    for (const userId of config.allowedUserIds) {
        try {
            if (message.length <= 4096) {
                await bot.api.sendMessage(userId, message, { parse_mode: "Markdown" });
            } else {
                await bot.api.sendMessage(userId, message.slice(0, 4096));
            }
        } catch (err) {
            console.error(`Failed to send scheduled task message:`, err);
        }
    }
}

// ─── Start a cron job for a task ─────────────────────────────────────
function startTaskJob(
    id: number,
    name: string,
    cronExpr: string,
    prompt: string
): void {
    const timezone = process.env.POST_TIMEZONE || "Europe/Berlin";

    const job = cron.schedule(
        cronExpr,
        async () => {
            console.log(`⏰ Running scheduled task: ${name}`);
            try {
                const result = await runAgent(prompt);
                await sendToUser(`⏰ **Scheduled: ${name}**\n\n${result}`);
                db.prepare(
                    "UPDATE scheduled_tasks SET last_run = datetime('now') WHERE id = ?"
                ).run(id);
            } catch (err) {
                console.error(`❌ Scheduled task "${name}" failed:`, err);
            }
        },
        { timezone }
    );

    activeTaskJobs.set(id, job);
}

// ─── Resume existing tasks on startup ────────────────────────────────
const existingTasks = db
    .prepare("SELECT id, name, cron, prompt FROM scheduled_tasks WHERE enabled = 1")
    .all() as Array<{ id: number; name: string; cron: string; prompt: string }>;

for (const task of existingTasks) {
    if (cron.validate(task.cron)) {
        startTaskJob(task.id, task.name, task.cron, task.prompt);
        console.log(`  📋 Resumed task: ${task.name} (${task.cron})`);
    }
}

// ─── Tool: schedule_task ─────────────────────────────────────────────
registerTool({
    name: "schedule_task",
    description:
        'Create a scheduled task that runs at specified times. Supports cron expressions (e.g. "0 9 * * 1-5" for 9 AM weekdays). The prompt is sent to the AI agent at each run time.',
    inputSchema: {
        type: "object" as const,
        properties: {
            name: { type: "string", description: "Task name." },
            cron: {
                type: "string",
                description:
                    'Cron expression (e.g. "0 9 * * 1-5" for 9 AM weekdays, "*/30 * * * *" for every 30 min).',
            },
            prompt: {
                type: "string",
                description: "The instruction/prompt to execute at each run.",
            },
        },
        required: ["name", "cron", "prompt"],
    },
    async execute(input: Record<string, unknown>): Promise<string> {
        const name = input.name as string;
        const cronExpr = input.cron as string;
        const prompt = input.prompt as string;

        if (!cron.validate(cronExpr)) {
            return JSON.stringify({
                error: `Invalid cron expression: "${cronExpr}". Use format: minute hour day month weekday.`,
            });
        }

        const result = db
            .prepare(
                "INSERT INTO scheduled_tasks (name, cron, prompt) VALUES (?, ?, ?)"
            )
            .run(name, cronExpr, prompt);

        const id = result.lastInsertRowid as number;
        startTaskJob(id, name, cronExpr, prompt);

        return JSON.stringify({
            success: true,
            id,
            message: `Task "${name}" scheduled with cron "${cronExpr}".`,
        });
    },
});

// ─── Tool: list_tasks ────────────────────────────────────────────────
registerTool({
    name: "list_scheduled_tasks",
    description: "List all scheduled tasks.",
    inputSchema: {
        type: "object" as const,
        properties: {},
        required: [],
    },
    async execute(): Promise<string> {
        const tasks = db
            .prepare(
                "SELECT id, name, cron, prompt, enabled, last_run, created_at FROM scheduled_tasks ORDER BY created_at"
            )
            .all();

        return JSON.stringify({ tasks, count: (tasks as unknown[]).length });
    },
});

// ─── Tool: pause_task ────────────────────────────────────────────────
registerTool({
    name: "pause_task",
    description: "Pause a scheduled task by ID.",
    inputSchema: {
        type: "object" as const,
        properties: {
            id: { type: "number", description: "Task ID to pause." },
        },
        required: ["id"],
    },
    async execute(input: Record<string, unknown>): Promise<string> {
        const id = input.id as number;

        db.prepare("UPDATE scheduled_tasks SET enabled = 0 WHERE id = ?").run(id);

        const job = activeTaskJobs.get(id);
        if (job) {
            job.stop();
            activeTaskJobs.delete(id);
        }

        return JSON.stringify({ success: true, message: `Task #${id} paused.` });
    },
});

// ─── Tool: delete_task ───────────────────────────────────────────────
registerTool({
    name: "delete_task",
    description: "Delete a scheduled task by ID.",
    inputSchema: {
        type: "object" as const,
        properties: {
            id: { type: "number", description: "Task ID to delete." },
        },
        required: ["id"],
    },
    async execute(input: Record<string, unknown>): Promise<string> {
        const id = input.id as number;

        const job = activeTaskJobs.get(id);
        if (job) {
            job.stop();
            activeTaskJobs.delete(id);
        }

        db.prepare("DELETE FROM scheduled_tasks WHERE id = ?").run(id);
        return JSON.stringify({ success: true, message: `Task #${id} deleted.` });
    },
});
