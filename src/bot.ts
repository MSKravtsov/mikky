import { Bot } from "grammy";
import { config } from "./config.js";
import { db } from "./db.js";
import { runAgent } from "./agent.js";
import { contextManager } from "./context.js";
import { transcribeVoice } from "./voice.js";

export const bot = new Bot(config.telegramToken);

// ─── Security middleware: user ID whitelist ───────────────────────────
bot.use(async (ctx, next) => {
    const userId = ctx.from?.id;

    if (!userId || !config.allowedUserIds.includes(userId)) {
        // Silently ignore unauthorized users — no response, no log
        return;
    }

    await next();
});

// ─── /compact command ────────────────────────────────────────────────
bot.command("compact", async (ctx) => {
    await ctx.replyWithChatAction("typing");
    const result = await contextManager.compact();
    await ctx.reply(`🗜️ ${result}`);
});

// ─── Message handler ─────────────────────────────────────────────────
bot.on("message:text", async (ctx) => {
    const userMessage = ctx.message.text;
    const userName = ctx.from.first_name || "User";

    console.log(`📨 ${userName}: ${userMessage}`);

    try {
        // Show "typing..." indicator while processing
        await ctx.replyWithChatAction("typing");

        const response = await runAgent(userMessage);

        // Log conversation for style learning
        const logStmt = db.prepare(
            "INSERT INTO conversation_log (role, content) VALUES (?, ?)"
        );
        logStmt.run("user", userMessage);
        logStmt.run("assistant", response);

        // Telegram has a 4096 char limit per message — split if needed
        if (response.length <= 4096) {
            await ctx.reply(response, { parse_mode: "Markdown" });
        } else {
            const chunks = splitMessage(response, 4096);
            for (const chunk of chunks) {
                await ctx.reply(chunk, { parse_mode: "Markdown" });
            }
        }

        console.log(`📤 Response sent (${response.length} chars)`);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("❌ Agent error:", msg);

        // Don't expose internal errors to the user
        await ctx.reply(
            "Sorry, something went wrong processing your message. Please try again."
        );
    }
});

// ─── Voice message handler ───────────────────────────────────────────
bot.on("message:voice", async (ctx) => {
    const userName = ctx.from.first_name || "User";

    // Check if Groq key is configured
    if (!config.groqApiKey) {
        await ctx.reply(
            "🎙️ Voice messages aren't configured yet.\n" +
            "Add your GROQ_API_KEY to .env to enable transcription."
        );
        return;
    }

    try {
        await ctx.replyWithChatAction("typing");

        // Download the voice file from Telegram
        const file = await ctx.getFile();
        const fileUrl = `https://api.telegram.org/file/bot${config.telegramToken}/${file.file_path}`;

        // Transcribe via Groq Whisper
        const transcription = await transcribeVoice(fileUrl);
        console.log(`🎙️ ${userName} [Voice]: ${transcription}`);

        // Run through the agent like a normal text message
        const agentInput = `[Voice message] ${transcription}`;
        const response = await runAgent(agentInput);

        // Log conversation
        const logStmt = db.prepare(
            "INSERT INTO conversation_log (role, content) VALUES (?, ?)"
        );
        logStmt.run("user", agentInput);
        logStmt.run("assistant", response);

        // Send response (split if needed)
        if (response.length <= 4096) {
            await ctx.reply(response, { parse_mode: "Markdown" });
        } else {
            const chunks = splitMessage(response, 4096);
            for (const chunk of chunks) {
                await ctx.reply(chunk, { parse_mode: "Markdown" });
            }
        }

        console.log(`📤 Response sent (${response.length} chars)`);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("❌ Voice processing error:", msg);

        await ctx.reply(
            "Sorry, I couldn't process your voice message. Please try again or send it as text."
        );
    }
});

// ─── Error handler ───────────────────────────────────────────────────
bot.catch((err) => {
    console.error("❌ Bot error:", err.message);
});

// ─── Helpers ─────────────────────────────────────────────────────────
function splitMessage(text: string, maxLength: number): string[] {
    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
        if (remaining.length <= maxLength) {
            chunks.push(remaining);
            break;
        }

        // Try to split at a newline near the limit
        let splitIndex = remaining.lastIndexOf("\n", maxLength);
        if (splitIndex === -1 || splitIndex < maxLength * 0.5) {
            // Fall back to splitting at a space
            splitIndex = remaining.lastIndexOf(" ", maxLength);
        }
        if (splitIndex === -1 || splitIndex < maxLength * 0.5) {
            // Hard split as last resort
            splitIndex = maxLength;
        }

        chunks.push(remaining.slice(0, splitIndex));
        remaining = remaining.slice(splitIndex).trimStart();
    }

    return chunks;
}
