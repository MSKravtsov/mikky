import { encoding_for_model } from "tiktoken";
import { chat, type Message } from "./llm.js";
import { db } from "./db.js";

// ─── Token counting ─────────────────────────────────────────────────
// Claude uses cl100k_base tokenizer (same as GPT-4)
let encoder: ReturnType<typeof encoding_for_model> | null = null;

function getEncoder() {
    if (!encoder) {
        encoder = encoding_for_model("gpt-4");
    }
    return encoder;
}

export function countTokens(text: string): number {
    return getEncoder().encode(text).length;
}

function messageTokens(msg: Message): number {
    if (typeof msg.content === "string") {
        return countTokens(msg.content) + 4; // role overhead
    }
    // For arrays (tool results, content blocks), estimate from JSON
    return countTokens(JSON.stringify(msg.content)) + 4;
}

// ─── Context Manager ─────────────────────────────────────────────────

const MAX_CONTEXT_TOKENS = 150_000; // Claude Sonnet context = 200K, leave headroom
const PRUNE_THRESHOLD = 0.8; // Prune when at 80% of max
const SUMMARY_TARGET_TOKENS = 500; // Target size for summaries

interface ConversationEntry {
    role: "user" | "assistant";
    content: string;
    timestamp: number;
}

export class ContextManager {
    private history: ConversationEntry[] = [];

    constructor() {
        // Load recent conversation history from DB
        const recent = db
            .prepare(
                "SELECT role, content, created_at FROM conversation_log ORDER BY id DESC LIMIT 50"
            )
            .all() as Array<{ role: string; content: string; created_at: string }>;

        this.history = recent
            .reverse()
            .map((r) => ({
                role: r.role as "user" | "assistant",
                content: r.content,
                timestamp: new Date(r.created_at).getTime(),
            }));
    }

    addMessage(role: "user" | "assistant", content: string): void {
        this.history.push({ role, content, timestamp: Date.now() });
    }

    getMessages(): Message[] {
        return this.history.map((h) => ({
            role: h.role,
            content: h.content,
        }));
    }

    getTotalTokens(): number {
        return this.history.reduce(
            (sum, h) => sum + countTokens(h.content) + 4,
            0
        );
    }

    needsPruning(): boolean {
        return this.getTotalTokens() > MAX_CONTEXT_TOKENS * PRUNE_THRESHOLD;
    }

    async prune(): Promise<string | null> {
        if (!this.needsPruning()) return null;

        // Take the first half of messages for summarization
        const midpoint = Math.floor(this.history.length / 2);
        if (midpoint < 2) return null;

        const toSummarize = this.history.slice(0, midpoint);
        const toKeep = this.history.slice(midpoint);

        // Summarize via LLM
        const conversationText = toSummarize
            .map((h) => `${h.role}: ${h.content}`)
            .join("\n\n");

        const summaryMessages: Message[] = [
            {
                role: "user",
                content: `Summarize this conversation in a concise paragraph. Capture key facts, decisions, and context needed for continuity. Keep it under ${SUMMARY_TARGET_TOKENS} tokens:\n\n${conversationText}`,
            },
        ];

        const response = await chat(summaryMessages, []);
        const summaryText = response.content
            .filter((b) => b.type === "text")
            .map((b) => ("text" in b ? b.text : ""))
            .join("\n");

        // Replace old messages with summary
        this.history = [
            {
                role: "assistant" as const,
                content: `[Context Summary] ${summaryText}`,
                timestamp: Date.now(),
            },
            ...toKeep,
        ];

        // Store summary in DB
        db.prepare(
            "INSERT INTO conversation_log (role, content) VALUES ('summary', ?)"
        ).run(summaryText);

        const oldTokens = toSummarize.reduce(
            (s, h) => s + countTokens(h.content),
            0
        );
        const newTokens = countTokens(summaryText);
        console.log(
            `🗜️ Context pruned: ${oldTokens} → ${newTokens} tokens (${midpoint} messages summarized)`
        );

        return summaryText;
    }

    async compact(): Promise<string> {
        // Force prune regardless of threshold
        const originalCount = this.history.length;
        const originalTokens = this.getTotalTokens();

        if (this.history.length < 4) {
            return "Not enough conversation history to compact.";
        }

        // Summarize all but last 4 messages
        const keepCount = 4;
        const toSummarize = this.history.slice(0, -keepCount);
        const toKeep = this.history.slice(-keepCount);

        const conversationText = toSummarize
            .map((h) => `${h.role}: ${h.content}`)
            .join("\n\n");

        const summaryMessages: Message[] = [
            {
                role: "user",
                content: `Summarize this conversation concisely, capturing key facts 
and context:\n\n${conversationText}`,
            },
        ];

        const response = await chat(summaryMessages, []);
        const summaryText = response.content
            .filter((b) => b.type === "text")
            .map((b) => ("text" in b ? b.text : ""))
            .join("\n");

        this.history = [
            {
                role: "assistant" as const,
                content: `[Context Summary] ${summaryText}`,
                timestamp: Date.now(),
            },
            ...toKeep,
        ];

        db.prepare(
            "INSERT INTO conversation_log (role, content) VALUES ('summary', ?)"
        ).run(summaryText);

        const newTokens = this.getTotalTokens();
        return `Compacted: ${originalCount} messages (${originalTokens} tokens) → ${this.history.length} messages (${newTokens} tokens)`;
    }
}

// Singleton
export const contextManager = new ContextManager();
