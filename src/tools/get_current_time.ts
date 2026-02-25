import { registerTool } from "./index.js";

registerTool({
    name: "get_current_time",
    description:
        "Returns the current date and time. Use this when the user asks what time it is, today's date, or anything related to the current moment.",
    inputSchema: {
        type: "object" as const,
        properties: {
            timezone: {
                type: "string",
                description:
                    'IANA timezone string (e.g. "Europe/Berlin", "America/New_York"). Defaults to the system timezone if omitted.',
            },
        },
        required: [],
    },
    async execute(input: Record<string, unknown>): Promise<string> {
        const tz = (input.timezone as string) || undefined;

        const now = new Date();

        const options: Intl.DateTimeFormatOptions = {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            timeZoneName: "short",
            ...(tz ? { timeZone: tz } : {}),
        };

        try {
            const formatted = new Intl.DateTimeFormat("en-US", options).format(now);
            return JSON.stringify({
                iso: now.toISOString(),
                formatted,
                timezone: tz || Intl.DateTimeFormat().resolvedOptions().timeZone,
                unix: Math.floor(now.getTime() / 1000),
            });
        } catch {
            return JSON.stringify({
                error: `Invalid timezone: "${tz}". Use an IANA timezone like "Europe/Berlin".`,
            });
        }
    },
});
