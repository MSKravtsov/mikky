export interface Tool {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    execute: (input: Record<string, unknown>) => Promise<string>;
}

const registry = new Map<string, Tool>();

export function registerTool(tool: Tool): void {
    if (registry.has(tool.name)) {
        throw new Error(`Tool "${tool.name}" is already registered.`);
    }
    registry.set(tool.name, tool);
}

export function getTool(name: string): Tool | undefined {
    return registry.get(name);
}

export function getAllTools(): Tool[] {
    return Array.from(registry.values());
}
