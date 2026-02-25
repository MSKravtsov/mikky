import { supabase } from "./supabase.js";

// ─── Track memory access ─────────────────────────────────────────────
export async function trackAccess(memoryId: number): Promise<void> {
    // Increment access_count and update last_accessed
    const { data: current } = await supabase
        .from("memories")
        .select("access_count")
        .eq("id", memoryId)
        .single();

    await supabase
        .from("memories")
        .update({
            access_count: ((current?.access_count as number) ?? 0) + 1,
            last_accessed: new Date().toISOString(),
        })
        .eq("id", memoryId);
}

// ─── Memory decay ────────────────────────────────────────────────────
// Reduce relevance of memories not accessed recently.
export async function applyDecay(): Promise<{ affected: number }> {
    const thirtyDaysAgo = new Date(
        Date.now() - 30 * 24 * 60 * 60 * 1000
    ).toISOString();

    // Fetch memories to decay
    const { data: toDec } = await supabase
        .from("memories")
        .select("id, relevance")
        .lt("last_accessed", thirtyDaysAgo)
        .gt("relevance", 0.1);

    if (!toDec || toDec.length === 0) return { affected: 0 };

    let affected = 0;
    for (const mem of toDec) {
        const newRelevance = Math.max(0.1, (mem.relevance as number) * 0.95);
        const { error } = await supabase
            .from("memories")
            .update({ relevance: newRelevance })
            .eq("id", mem.id);
        if (!error) affected++;
    }

    return { affected };
}

// ─── Boost recently accessed memories ────────────────────────────────
export async function boostFrequentlyAccessed(): Promise<{ affected: number }> {
    const sevenDaysAgo = new Date(
        Date.now() - 7 * 24 * 60 * 60 * 1000
    ).toISOString();

    const { data: toBoost } = await supabase
        .from("memories")
        .select("id, relevance")
        .gt("access_count", 5)
        .gt("last_accessed", sevenDaysAgo)
        .lt("relevance", 2.0);

    if (!toBoost || toBoost.length === 0) return { affected: 0 };

    let affected = 0;
    for (const mem of toBoost) {
        const newRelevance = Math.min(2.0, (mem.relevance as number) * 1.05);
        const { error } = await supabase
            .from("memories")
            .update({ relevance: newRelevance })
            .eq("id", mem.id);
        if (!error) affected++;
    }

    return { affected };
}

// ─── Find duplicate memories ─────────────────────────────────────────
export async function findDuplicates(): Promise<
    Array<{
        id1: number;
        id2: number;
        content1: string;
        content2: string;
        similarity: number;
    }>
> {
    const { data: memories } = await supabase
        .from("memories")
        .select("id, content")
        .order("id");

    if (!memories) return [];

    const duplicates: Array<{
        id1: number;
        id2: number;
        content1: string;
        content2: string;
        similarity: number;
    }> = [];

    for (let i = 0; i < memories.length; i++) {
        for (let j = i + 1; j < memories.length; j++) {
            const sim = wordOverlap(
                memories[i]!.content as string,
                memories[j]!.content as string
            );
            if (sim > 0.7) {
                duplicates.push({
                    id1: memories[i]!.id as number,
                    id2: memories[j]!.id as number,
                    content1: memories[i]!.content as string,
                    content2: memories[j]!.content as string,
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
export async function runMaintenance(): Promise<{
    decay: { affected: number };
    boost: { affected: number };
    duplicates: number;
}> {
    const decay = await applyDecay();
    const boost = await boostFrequentlyAccessed();
    const duplicates = await findDuplicates();

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
