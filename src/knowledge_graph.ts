import { supabase } from "./supabase.js";

// ─── Schema is created via Supabase migrations ──────────────────────

// ─── Graph operations ────────────────────────────────────────────────

export interface Entity {
    id: number;
    name: string;
    type: string;
    properties: Record<string, unknown>;
    created_at: string;
    updated_at?: string;
}

export interface Relationship {
    id: number;
    from_id: number;
    to_id: number;
    type: string;
    properties: Record<string, unknown>;
    created_at: string;
}

export async function addEntity(
    name: string,
    type: string,
    properties: Record<string, unknown> = {}
): Promise<Entity> {
    const { data, error } = await supabase
        .from("entities")
        .upsert(
            { name, type, properties, updated_at: new Date().toISOString() },
            { onConflict: "name,type" }
        )
        .select()
        .single();

    if (error) throw new Error(`addEntity failed: ${error.message}`);
    return data as Entity;
}

export async function addRelationship(
    fromId: number,
    toId: number,
    type: string,
    properties: Record<string, unknown> = {}
): Promise<Relationship> {
    const { data, error } = await supabase
        .from("relationships")
        .insert({ from_id: fromId, to_id: toId, type, properties })
        .select()
        .single();

    if (error) throw new Error(`addRelationship failed: ${error.message}`);
    return data as Relationship;
}

export async function findEntity(
    name: string,
    type?: string
): Promise<Entity | undefined> {
    let query = supabase.from("entities").select("*").eq("name", name);
    if (type) query = query.eq("type", type);

    const { data, error } = await query.limit(1).maybeSingle();
    if (error) throw new Error(`findEntity failed: ${error.message}`);
    return (data as Entity) ?? undefined;
}

export async function getConnections(
    entityId: number
): Promise<Array<{ relationship: string; direction: string; entity: Entity }>> {
    // Outgoing
    const { data: outgoing, error: e1 } = await supabase
        .from("relationships")
        .select("type, entities!relationships_to_id_fkey(*)")
        .eq("from_id", entityId);

    if (e1) throw new Error(`getConnections outgoing failed: ${e1.message}`);

    // Incoming
    const { data: incoming, error: e2 } = await supabase
        .from("relationships")
        .select("type, entities!relationships_from_id_fkey(*)")
        .eq("to_id", entityId);

    if (e2) throw new Error(`getConnections incoming failed: ${e2.message}`);

    const results: Array<{ relationship: string; direction: string; entity: Entity }> = [];

    for (const row of outgoing ?? []) {
        const entity = (row as any).entities as Entity;
        if (entity) {
            results.push({ relationship: row.type, direction: "outgoing", entity });
        }
    }

    for (const row of incoming ?? []) {
        const entity = (row as any).entities as Entity;
        if (entity) {
            results.push({ relationship: row.type, direction: "incoming", entity });
        }
    }

    return results;
}

export async function traverseGraph(
    startId: number,
    maxDepth: number = 3
): Promise<Array<{ depth: number; entity: Entity; via: string }>> {
    const visited = new Set<number>();
    const results: Array<{ depth: number; entity: Entity; via: string }> = [];

    async function dfs(entityId: number, depth: number, via: string) {
        if (depth > maxDepth || visited.has(entityId)) return;
        visited.add(entityId);

        const { data: entity } = await supabase
            .from("entities")
            .select("*")
            .eq("id", entityId)
            .maybeSingle();

        if (entity) {
            results.push({ depth, entity: entity as Entity, via });
            const connections = await getConnections(entityId);
            for (const conn of connections) {
                await dfs(conn.entity.id, depth + 1, conn.relationship);
            }
        }
    }

    await dfs(startId, 0, "start");
    return results;
}

console.log("🕸️ Knowledge graph ready");
