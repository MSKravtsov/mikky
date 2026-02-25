import { encoding_for_model } from "tiktoken";
import { chat, type Message } from "./llm.js";
import { supabase } from "./supabase.js";

// ─── Token counting ─────────────────────────────────────────────────
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
    return countTokens(JSON.stringify(msg.content)) + 4;
}

// ─── Context Manager ─────────────────────────────────────────────────

const MAX_CONTEXT_TOKENS = 150_000;
const PRUNE_THRESHOLD = 0.8;
const SUMMARY_TARGET_TOKENS = 500;

interface ConversationEntry {
    role: "user" | "assistant";
    content: string;
    timestamp: number;
}

export class ContextManager {
    private history: ConversationEntry[] = [];

    private constructor() { }

    static async create(): Promise<ContextManager> {
        const mgr = new ContextManager();
        await mgr.loadHistory();
        return mgr;
    }

    private async loadHistory(): Promise<void> {
        const { data, error } = await supabase
            .from("conversation_log")
            .select("role, content, created_at")
            .order("id", { ascending: false })
            .limit(50);

        if (error) {
            console.error("⚠️ Failed to load conversation history:", error.message);
            return;
        }

        this.history = (data ?? [])
            .reverse()
            .map((r: any) => ({
                role: r.role as "user" | "assistant",
                content: r.content as string,
                timestamp: new Date(r.created_at as string).getTime(),
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

        const midpoint = Math.floor(this.history.length / 2);
        if (midpoint < 2) return null;

        const toSummarize = this.history.slice(0, midpoint);
        const toKeep = this.history.slice(midpoint);

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

        this.history = [
            {
                role: "assistant" as const,
                content: `[Context Summary] ${summaryText}`,
                timestamp: Date.now(),
            },
            ...toKeep,
        ];

        // Store summary in DB
        await supabase
            .from("conversation_log")
            .insert({ role: "summary", content: summaryText });

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
        const originalCount = this.history.length;
        const originalTokens = this.getTotalTokens();

        if (this.history.length < 4) {
            return "Not enough conversation history to compact.";
        }

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

        await supabase
            .from("conversation_log")
            .insert({ role: "summary", content: summaryText });

        const newTokens = this.getTotalTokens();
        return `Compacted: ${originalCount} messages (${originalTokens} tokens) → ${this.history.length} messages (${newTokens} tokens)`;
    }
}

// Singleton — created async, exported as a promise
let _contextManager: ContextManager | null = null;

export async function getContextManager(): Promise<ContextManager> {
    if (!_contextManager) {
        _contextManager = await ContextManager.create();
    }
    return _contextManager;
}
