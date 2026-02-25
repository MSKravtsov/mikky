import { db } from "./db.js";

// ─── Add access tracking columns (safe — IF NOT EXISTS equivalent) ──
try {
    db.exec("ALTER TABLE memories ADD COLUMN access_count INTEGER DEFAULT 0");
} catch {
    // Column already exists
}
try {
    db.exec(
        "ALTER TABLE memories ADD COLUMN last_accessed TEXT DEFAULT (datetime('now'))"
    );
} catch {
    // Column already exists
}
try {
    db.exec("ALTER TABLE memories ADD COLUMN relevance REAL DEFAULT 1.0");
} catch {
    // Column already exists
}

// ─── Track memory access ─────────────────────────────────────────────
export function trackAccess(memoryId: number): void {
    db.prepare(
        "UPDATE memories SET access_count = access_count + 1, last_accessed = datetime('now') WHERE id = ?"
    ).run(memoryId);
}

// ─── Memory decay ────────────────────────────────────────────────────
// Reduce relevance of memories not accessed recently.
// Called periodically (e.g. daily via heartbeat).
export function applyDecay(): { affected: number } {
    // Decay memories not accessed in over 30 days
    const result = db
        .prepare(
            `UPDATE memories SET relevance = MAX(0.1, relevance * 0.95)
       WHERE last_accessed < datetime('now', '-30 days')
       AND relevance > 0.1`
        )
        .run();

    return { affected: result.changes };
}

// ─── Boost recently accessed memories ────────────────────────────────
export function boostFrequentlyAccessed(): { affected: number } {
    const result = db
        .prepare(
            `UPDATE memories SET relevance = MIN(2.0, relevance * 1.05)
       WHERE access_count > 5
       AND last_accessed > datetime('now', '-7 days')
       AND relevance < 2.0`
        )
        .run();

    return { affected: result.changes };
}

// ─── Merge duplicate memories ────────────────────────────────────────
export function findDuplicates(): Array<{
    id1: number;
    id2: number;
    content1: string;
    content2: string;
    similarity: number;
}> {
    // Find memories with very similar content (simple word overlap check)
    const memories = db
        .prepare("SELECT id, content FROM memories ORDER BY id")
        .all() as Array<{ id: number; content: string }>;

    const duplicates: Array<{
        id1: number;
        id2: number;
        content1: string;
        content2: string;
        similarity: number;
    }> = [];

    for (let i = 0; i < memories.length; i++) {
        for (let j = i + 1; j < memories.length; j++) {
            const sim = wordOverlap(memories[i]!.content, memories[j]!.content);
            if (sim > 0.7) {
                duplicates.push({
                    id1: memories[i]!.id,
                    id2: memories[j]!.id,
                    content1: memories[i]!.content,
                    content2: memories[j]!.content,
                    similarity: Math.round(sim * 100) / 100,
                });
            }
        }
    }

    return duplicates;
}

function wordOverlap(a: string, b: string): number {
    const wordsA = new Set(a.toLowerCase().split(/\s+/));
    const wordsB = new Set(b.toLowerCase().split(/\s+/));
    const intersection = new Set([...wordsA].filter((w) => wordsB.has(w)));
    const union = new Set([...wordsA, ...wordsB]);
    return union.size === 0 ? 0 : intersection.size / union.size;
}

// ─── Run full maintenance cycle ──────────────────────────────────────
export function runMaintenance(): {
    decay: { affected: number };
    boost: { affected: number };
    duplicates: number;
} {
    const decay = applyDecay();
    const boost = boostFrequentlyAccessed();
    const duplicates = findDuplicates();

    console.log(
        `🧹 Memory maintenance: decayed ${decay.affected}, boosted ${boost.affected}, found ${duplicates.length} potential duplicates`
    );

    return {
        decay,
        boost,
        duplicates: duplicates.length,
    };
}

console.log("🧬 Self-evolving memory ready");
