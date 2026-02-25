import { db } from "./db.js";

// ─── Schema for knowledge graph ─────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS entities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    properties TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_entities_name_type
    ON entities(name, type);

  CREATE TABLE IF NOT EXISTS relationships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    to_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    properties TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_rel_from ON relationships(from_id);
  CREATE INDEX IF NOT EXISTS idx_rel_to ON relationships(to_id);
`);

// ─── Graph operations ────────────────────────────────────────────────

export interface Entity {
    id: number;
    name: string;
    type: string;
    properties: Record<string, unknown>;
    created_at: string;
}

export interface Relationship {
    id: number;
    from_id: number;
    to_id: number;
    type: string;
    properties: Record<string, unknown>;
    created_at: string;
}

export function addEntity(
    name: string,
    type: string,
    properties: Record<string, unknown> = {}
): Entity {
    const result = db
        .prepare(
            `INSERT INTO entities (name, type, properties) VALUES (?, ?, ?)
       ON CONFLICT(name, type) DO UPDATE SET
         properties = excluded.properties,
         updated_at = datetime('now')`
        )
        .run(name, type, JSON.stringify(properties));

    return db
        .prepare("SELECT * FROM entities WHERE id = ?")
        .get(result.lastInsertRowid) as Entity;
}

export function addRelationship(
    fromId: number,
    toId: number,
    type: string,
    properties: Record<string, unknown> = {}
): Relationship {
    const result = db
        .prepare(
            "INSERT INTO relationships (from_id, to_id, type, properties) VALUES (?, ?, ?, ?)"
        )
        .run(fromId, toId, type, JSON.stringify(properties));

    return db
        .prepare("SELECT * FROM relationships WHERE id = ?")
        .get(result.lastInsertRowid) as Relationship;
}

export function findEntity(name: string, type?: string): Entity | undefined {
    if (type) {
        return db
            .prepare("SELECT * FROM entities WHERE name = ? AND type = ?")
            .get(name, type) as Entity | undefined;
    }
    return db
        .prepare("SELECT * FROM entities WHERE name = ?")
        .get(name) as Entity | undefined;
}

export function getConnections(
    entityId: number
): Array<{ relationship: string; direction: string; entity: Entity }> {
    const outgoing = db
        .prepare(
            `SELECT r.type as rel_type, e.* FROM relationships r
       JOIN entities e ON e.id = r.to_id
       WHERE r.from_id = ?`
        )
        .all(entityId) as Array<{ rel_type: string } & Entity>;

    const incoming = db
        .prepare(
            `SELECT r.type as rel_type, e.* FROM relationships r
       JOIN entities e ON e.id = r.from_id
       WHERE r.to_id = ?`
        )
        .all(entityId) as Array<{ rel_type: string } & Entity>;

    return [
        ...outgoing.map((r) => ({
            relationship: r.rel_type,
            direction: "outgoing",
            entity: { id: r.id, name: r.name, type: r.type, properties: JSON.parse(r.properties as unknown as string), created_at: r.created_at },
        })),
        ...incoming.map((r) => ({
            relationship: r.rel_type,
            direction: "incoming",
            entity: { id: r.id, name: r.name, type: r.type, properties: JSON.parse(r.properties as unknown as string), created_at: r.created_at },
        })),
    ];
}

export function traverseGraph(
    startId: number,
    maxDepth: number = 3
): Array<{ depth: number; entity: Entity; via: string }> {
    const visited = new Set<number>();
    const results: Array<{ depth: number; entity: Entity; via: string }> = [];

    function dfs(entityId: number, depth: number, via: string) {
        if (depth > maxDepth || visited.has(entityId)) return;
        visited.add(entityId);

        const entity = db
            .prepare("SELECT * FROM entities WHERE id = ?")
            .get(entityId) as Entity | undefined;

        if (entity) {
            results.push({ depth, entity, via });
            const connections = getConnections(entityId);
            for (const conn of connections) {
                dfs(conn.entity.id, depth + 1, conn.relationship);
            }
        }
    }

    dfs(startId, 0, "start");
    return results;
}

console.log("🕸️ Knowledge graph ready");
