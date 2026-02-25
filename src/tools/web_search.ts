import { registerTool } from "./index.js";

// ─── Web Search via Tavily API ──────────────────────────────────────
// Free tier: 1,000 searches/month at tavily.com
// Provides AI-optimized search results with clean content extraction.

const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

if (!TAVILY_API_KEY) {
    console.log("🔍 Web search disabled — set TAVILY_API_KEY to enable (free at tavily.com)");
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
        const maxResults = Math.min((input.max_results as number) || 5, 10);
        const searchDepth = (input.search_depth as string) || "basic";
        const includeAnswer = input.include_answer !== false;

        try {
            const response = await fetch("https://api.tavily.com/search", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    api_key: TAVILY_API_KEY,
                    query,
                    max_results: maxResults,
                    search_depth: searchDepth,
                    include_answer: includeAnswer,
                    include_raw_content: false,
                }),
            });

            if (!response.ok) {
                const errText = await response.text();
                return JSON.stringify({
                    error: `Search API error (${response.status}): ${errText.slice(0, 500)}`,
                });
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

            // Format results for Claude
            const results = (data.results || []).map((r, i) => ({
                rank: i + 1,
                title: r.title,
                url: r.url,
                snippet: r.content?.slice(0, 500),
                relevance: Math.round(r.score * 100) + "%",
            }));

            return JSON.stringify({
                query,
                answer: data.answer || null,
                results,
                total: results.length,
            });
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return JSON.stringify({ error: `Search failed: ${msg}` });
        }
    },
});

if (TAVILY_API_KEY) {
    console.log("🔍 Web search ready (Tavily)");
}
