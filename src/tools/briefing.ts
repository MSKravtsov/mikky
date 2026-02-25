import { registerTool } from "./index.js";
import { supabase } from "../supabase.js";

// ─── Tool: get_weather ───────────────────────────────────────────────
// Uses Open-Meteo API (free, no API key required)
registerTool({
    name: "get_weather",
    description:
        "Get current weather for a location. Uses Open-Meteo (free, no API key). Provide latitude and longitude, or a city name.",
    inputSchema: {
        type: "object" as const,
        properties: {
            latitude: { type: "number", description: "Latitude." },
            longitude: { type: "number", description: "Longitude." },
            city: {
                type: "string",
                description:
                    "City name (used for geocoding if lat/lon not provided).",
            },
        },
        required: [],
    },
    async execute(input: Record<string, unknown>): Promise<string> {
        let lat = input.latitude as number | undefined;
        let lon = input.longitude as number | undefined;

        // Geocode city if needed
        if (!lat || !lon) {
            const city = (input.city as string) || "Berlin";
            try {
                const geoResp = await fetch(
                    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`
                );
                const geoData = (await geoResp.json()) as {
                    results?: Array<{ latitude: number; longitude: number; name: string }>;
                };
                if (geoData.results && geoData.results.length > 0) {
                    lat = geoData.results[0]!.latitude;
                    lon = geoData.results[0]!.longitude;
                } else {
                    return JSON.stringify({ error: `City "${city}" not found.` });
                }
            } catch (err) {
                return JSON.stringify({
                    error: `Geocoding failed: ${err instanceof Error ? err.message : String(err)}`,
                });
            }
        }

        try {
            const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m&timezone=auto`;
            const resp = await fetch(url);
            const data = (await resp.json()) as {
                current: {
                    temperature_2m: number;
                    apparent_temperature: number;
                    weather_code: number;
                    wind_speed_10m: number;
                    relative_humidity_2m: number;
                };
                timezone: string;
            };

            const weatherCodes: Record<number, string> = {
                0: "Clear sky ☀️",
                1: "Mainly clear 🌤️",
                2: "Partly cloudy ⛅",
                3: "Overcast ☁️",
                45: "Foggy 🌫️",
                48: "Rime fog 🌫️",
                51: "Light drizzle 🌦️",
                53: "Moderate drizzle 🌦️",
                55: "Dense drizzle 🌧️",
                61: "Slight rain 🌧️",
                63: "Moderate rain 🌧️",
                65: "Heavy rain 🌧️",
                71: "Slight snow 🌨️",
                73: "Moderate snow 🌨️",
                75: "Heavy snow ❄️",
                80: "Rain showers 🌧️",
                95: "Thunderstorm ⛈️",
            };

            return JSON.stringify({
                temperature: `${data.current.temperature_2m}°C`,
                feels_like: `${data.current.apparent_temperature}°C`,
                condition:
                    weatherCodes[data.current.weather_code] ||
                    `Code ${data.current.weather_code}`,
                wind: `${data.current.wind_speed_10m} km/h`,
                humidity: `${data.current.relative_humidity_2m}%`,
                timezone: data.timezone,
            });
        } catch (err) {
            return JSON.stringify({
                error: `Weather fetch failed: ${err instanceof Error ? err.message : String(err)}`,
            });
        }
    },
});

// ─── Tool: get_briefing ──────────────────────────────────────────────
registerTool({
    name: "get_briefing",
    description:
        "Compile a morning briefing with weather, pending tasks, and recent memories. Use this to proactively send morning updates.",
    inputSchema: {
        type: "object" as const,
        properties: {
            city: { type: "string", description: "City for weather (default: Berlin)." },
        },
        required: [],
    },
    async execute(input: Record<string, unknown>): Promise<string> {
        const city = (input.city as string) || "Berlin";

        // Pending confirmed topics
        const { data: pendingTopics } = await supabase
            .from("topics")
            .select("day_index, topic")
            .eq("status", "confirmed")
            .order("day_index");

        // Recent memories
        const { data: recentMemories } = await supabase
            .from("memories")
            .select("content, category")
            .order("created_at", { ascending: false })
            .limit(5);

        // Scheduled tasks
        let scheduledTasks: unknown[] = [];
        try {
            const { data } = await supabase
                .from("scheduled_tasks")
                .select("name, cron, last_run")
                .eq("enabled", true);
            scheduledTasks = data ?? [];
        } catch {
            // Table may not exist yet
        }

        return JSON.stringify({
            city,
            pending_linkedin_topics: pendingTopics?.length ?? 0,
            topics: pendingTopics ?? [],
            recent_memories: recentMemories ?? [],
            scheduled_tasks: scheduledTasks,
            instruction:
                "Compile a friendly morning briefing. Include weather (call get_weather), pending tasks, and any relevant reminders from memory.",
        });
    },
});
