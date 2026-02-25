import { registerTool } from "./index.js";
import {
    addEntity,
    addRelationship,
    findEntity,
    getConnections,
    traverseGraph,
} from "../knowledge_graph.js";
import { supabase } from "../supabase.js";

// ─── Tool: add_entity ────────────────────────────────────────────────
registerTool({
    name: "add_entity",
    description:
        "Add an entity to the knowledge graph. Entities are people, companies, projects, technologies, concepts, etc. Use this to build a web of connected knowledge.",
    inputSchema: {
        type: "object" as const,
        properties: {
            name: { type: "string", description: "Entity name." },
            type: {
                type: "string",
                description:
                    'Entity type: person, company, project, technology, concept, skill, topic, etc.',
            },
            properties: {
                type: "object",
                description:
                    'Additional properties as key-value pairs (e.g. {"url": "...", "description": "..."}).',
            },
        },
        required: ["name", "type"],
    },
    async execute(input: Record<string, unknown>): Promise<string> {
        const entity = await addEntity(
            input.name as string,
            input.type as string,
            (input.properties as Record<string, unknown>) || {}
        );
        return JSON.stringify({
            success: true,
            entity: { id: entity.id, name: entity.name, type: entity.type },
            message: `Entity "${entity.name}" (${entity.type}) added to knowledge graph.`,
        });
    },
});

// ─── Tool: add_relationship ──────────────────────────────────────────
registerTool({
    name: "add_relationship",
    description:
        'Link two entities in the knowledge graph. E.g. "Mikhail" --works_at--> "Acme Corp", or "Python" --used_in--> "Data Pipeline".',
    inputSchema: {
        type: "object" as const,
        properties: {
            from_name: { type: "string", description: "Source entity name." },
            from_type: { type: "string", description: "Source entity type." },
            to_name: { type: "string", description: "Target entity name." },
            to_type: { type: "string", description: "Target entity type." },
            relationship: {
                type: "string",
                description:
                    'Relationship type (e.g. "works_at", "uses", "interested_in", "knows", "created").',
            },
        },
        required: ["from_name", "from_type", "to_name", "to_type", "relationship"],
    },
    async execute(input: Record<string, unknown>): Promise<string> {
        const from = await findEntity(input.from_name as string, input.from_type as string);
        const to = await findEntity(input.to_name as string, input.to_type as string);

        // Auto-create entities if they don't exist
        const fromEntity = from || await addEntity(input.from_name as string, input.from_type as string);
        const toEntity = to || await addEntity(input.to_name as string, input.to_type as string);

        const rel = await addRelationship(
            fromEntity.id,
            toEntity.id,
            input.relationship as string
        );

        return JSON.stringify({
            success: true,
            message: `${fromEntity.name} --[${rel.type}]--> ${toEntity.name}`,
        });
    },
});

// ─── Tool: query_graph ───────────────────────────────────────────────
registerTool({
    name: "query_graph",
    description:
        "Query the knowledge graph. Find entities and their connections.",
    inputSchema: {
        type: "object" as const,
        properties: {
            name: { type: "string", description: "Entity name to look up." },
            type: { type: "string", description: "Optional type filter." },
        },
        required: ["name"],
    },
    async execute(input: Record<string, unknown>): Promise<string> {
        const entity = await findEntity(
            input.name as string,
            input.type as string | undefined
        );

        if (!entity) {
            return JSON.stringify({
                error: `Entity "${input.name}" not found in knowledge graph.`,
            });
        }

        const connections = await getConnections(entity.id);
        return JSON.stringify({
            entity: {
                id: entity.id,
                name: entity.name,
                type: entity.type,
                properties: entity.properties,
            },
            connections: connections.map((c) => ({
                relationship: c.relationship,
                direction: c.direction,
                entity: { name: c.entity.name, type: c.entity.type },
            })),
        });
    },
});

// ─── Tool: traverse_graph ────────────────────────────────────────────
registerTool({
    name: "traverse_graph",
    description:
        "Traverse the knowledge graph from a starting entity. Finds all connected entities up to a given depth.",
    inputSchema: {
        type: "object" as const,
        properties: {
            name: { type: "string", description: "Starting entity name." },
            max_depth: {
                type: "number",
                description: "Maximum traversal depth (default: 3).",
            },
        },
        required: ["name"],
    },
    async execute(input: Record<string, unknown>): Promise<string> {
        const entity = await findEntity(input.name as string);
        if (!entity) {
            return JSON.stringify({
                error: `Entity "${input.name}" not found.`,
            });
        }

        const maxDepth = (input.max_depth as number) || 3;
        const results = await traverseGraph(entity.id, maxDepth);

        return JSON.stringify({
            start: entity.name,
            results: results.map((r) => ({
                depth: r.depth,
                via: r.via,
                name: r.entity.name,
                type: r.entity.type,
            })),
        });
    },
});

// ─── Tool: list_entities ─────────────────────────────────────────────
registerTool({
    name: "list_entities",
    description: "List all entities in the knowledge graph, optionally filtered by type.",
    inputSchema: {
        type: "object" as const,
        properties: {
            type: { type: "string", description: "Optional entity type filter." },
            limit: { type: "number", description: "Max results (default: 50)." },
        },
        required: [],
    },
    async execute(input: Record<string, unknown>): Promise<string> {
        const type = input.type as string | undefined;
        const limit = (input.limit as number) || 50;

        let q = supabase
            .from("entities")
            .select("id, name, type")
            .order("name")
            .limit(limit);

        if (type) {
            q = q.eq("type", type);
        }

        const { data: entities } = await q;

        return JSON.stringify({
            entities: entities ?? [],
            count: entities?.length ?? 0,
        });
    },
});
