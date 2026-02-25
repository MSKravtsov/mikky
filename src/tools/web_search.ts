import { registerTool } from "./index.js";

// ─── Web Search via Tavily API ──────────────────────────────────────
// Free tier: 1,000 searches/month at tavily.com
// Provides AI-optimized search results with clean content extraction.

const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

if (!TAVILY_API_KEY) {
    console.log("🔍 Web search disabled — set TAVILY_API_KEY to enable (free at tavily.com)");
}

// ─── Reusable search function (used by tool + scheduler) ────────────
export interface SearchResult {
    title: string;
    url: string;
    snippet: string;
}

export async function searchWeb(
    query: string,
    maxResults = 5
): Promise<{ answer: string | null; results: SearchResult[] }> {
    if (!TAVILY_API_KEY) {
        return { answer: null, results: [] };
    }

    try {
        const response = await fetch("https://api.tavily.com/search", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                api_key: TAVILY_API_KEY,
                query,
                max_results: Math.min(maxResults, 10),
                search_depth: "basic",
                include_answer: true,
                include_raw_content: false,
            }),
        });

        if (!response.ok) {
            console.error(`🔍 Search API error (${response.status})`);
            return { answer: null, results: [] };
        }

        const data = (await response.json()) as {
            answer?: string;
            results?: Array<{
                title: string;
                url: string;
                content: string;
                score: number;
            }>;
        };

        const results = (data.results || []).map((r) => ({
            title: r.title,
            url: r.url,
            snippet: r.content?.slice(0, 500) || "",
        }));

        return { answer: data.answer || null, results };
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`🔍 Search failed: ${msg}`);
        return { answer: null, results: [] };
    }
}

export function isSearchAvailable(): boolean {
    return !!TAVILY_API_KEY;
}

// ─── Tool: web_search ───────────────────────────────────────────────
registerTool({
    name: "web_search",
    description:
        "Search the internet for current information. Use this for recent news, trending topics, fact-checking, finding articles, or any question that needs up-to-date information. Returns relevant web results with titles, URLs, and content snippets.",
    inputSchema: {
        type: "object" as const,
        properties: {
            query: {
                type: "string",
                description:
                    "Search query. Be specific for better results (e.g. 'latest AI regulation EU 2025' instead of 'AI news').",
            },
            max_results: {
                type: "number",
                description: "Number of results to return (default: 5, max: 10).",
            },
            search_depth: {
                type: "string",
                description:
                    "'basic' for fast results, 'advanced' for deeper search with more content (default: basic).",
            },
            include_answer: {
                type: "boolean",
                description:
                    "If true, includes a short AI-generated answer summarizing the results (default: true).",
            },
        },
        required: ["query"],
    },
    async execute(input: Record<string, unknown>): Promise<string> {
        if (!TAVILY_API_KEY) {
            return JSON.stringify({
                error: "Web search is not configured. Set TAVILY_API_KEY environment variable.",
                setup: "Get a free API key at https://tavily.com",
            });
        }

        const query = input.query as string;
        const maxResults = (input.max_results as number) || 5;
        const { answer, results } = await searchWeb(query, maxResults);

        return JSON.stringify({
            query,
            answer,
            results: results.map((r, i) => ({ rank: i + 1, ...r })),
            total: results.length,
        });
    },
});

if (TAVILY_API_KEY) {
    console.log("🔍 Web search ready (Tavily)");
}

