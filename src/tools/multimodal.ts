import { registerTool } from "./index.js";
import { supabase } from "../supabase.js";

// ─── Multimodal Memory Tools ────────────────────────────────────────
// Process images, audio, and documents → extract info → store as memories.

// ─── Tool: process_image ─────────────────────────────────────────────
registerTool({
    name: "process_image",
    description:
        "Analyze an image and store the description as a memory. Uses Claude Vision for image understanding. Call this when the user sends a photo.",
    inputSchema: {
        type: "object" as const,
        properties: {
            image_description: {
                type: "string",
                description:
                    "Description of the image (from vision analysis or user context).",
            },
            context: {
                type: "string",
                description: "Additional context about the image.",
            },
        },
        required: ["image_description"],
    },
    async execute(input: Record<string, unknown>): Promise<string> {
        const description = input.image_description as string;
        const context = (input.context as string) || "";

        const memoryContent = context
            ? `[Image] ${description} — Context: ${context}`
            : `[Image] ${description}`;

        const { error } = await supabase
            .from("memories")
            .insert({ content: memoryContent, category: "visual" });

        if (error) {
            return JSON.stringify({ error: `Failed to store image memory: ${error.message}` });
        }

        return JSON.stringify({
            success: true,
            message: `Image memory stored: "${description.slice(0, 100)}..."`,
        });
    },
});

// ─── Tool: process_audio ─────────────────────────────────────────────
registerTool({
    name: "process_audio",
    description:
        "Store an audio transcription as a memory. Call this when voice messages are transcribed.",
    inputSchema: {
        type: "object" as const,
        properties: {
            transcription: {
                type: "string",
                description: "Transcription text from audio.",
            },
            source: {
                type: "string",
                description: 'Source type (e.g. "voice_message", "audio_file").',
            },
        },
        required: ["transcription"],
    },
    async execute(input: Record<string, unknown>): Promise<string> {
        const transcription = input.transcription as string;
        const source = (input.source as string) || "voice_message";

        const { error } = await supabase
            .from("memories")
            .insert({ content: `[Audio/${source}] ${transcription}`, category: "audio" });

        if (error) {
            return JSON.stringify({ error: `Failed to store audio memory: ${error.message}` });
        }

        return JSON.stringify({
            success: true,
            message: `Audio memory stored (${transcription.length} chars).`,
        });
    },
});

// ─── Tool: process_document ──────────────────────────────────────────
registerTool({
    name: "process_document",
    description:
        "Extract and store key information from a document as memory. Call this for PDFs, text files, etc.",
    inputSchema: {
        type: "object" as const,
        properties: {
            filename: { type: "string", description: "Document filename." },
            content: {
                type: "string",
                description: "Extracted text content from the document.",
            },
            summary: {
                type: "string",
                description: "Brief summary of the document.",
            },
        },
        required: ["filename", "content"],
    },
    async execute(input: Record<string, unknown>): Promise<string> {
        const filename = input.filename as string;
        const content = input.content as string;
        const summary = (input.summary as string) || "";

        const memoryContent = summary
            ? `[Document: ${filename}] ${summary}\n\nKey content: ${content.slice(0, 1000)}`
            : `[Document: ${filename}] ${content.slice(0, 2000)}`;

        const { error } = await supabase
            .from("memories")
            .insert({ content: memoryContent, category: "document" });

        if (error) {
            return JSON.stringify({ error: `Failed to store document: ${error.message}` });
        }

        return JSON.stringify({
            success: true,
            message: `Document "${filename}" stored in memory.`,
        });
    },
});

// ─── Tool: search_multimodal ─────────────────────────────────────────
registerTool({
    name: "search_multimodal",
    description:
        "Search across all media types in memory (images, audio, documents).",
    inputSchema: {
        type: "object" as const,
        properties: {
            query: { type: "string", description: "Search query." },
            media_type: {
                type: "string",
                enum: ["visual", "audio", "document", "all"],
                description: "Filter by media type (default: all).",
            },
        },
        required: ["query"],
    },
    async execute(input: Record<string, unknown>): Promise<string> {
        const query = input.query as string;
        const mediaType = (input.media_type as string) || "all";

        let q = supabase
            .from("memories")
            .select("id, content, category, created_at")
            .ilike("content", `%${query}%`)
            .order("created_at", { ascending: false })
            .limit(10);

        if (mediaType === "all") {
            q = q.in("category", ["visual", "audio", "document"]);
        } else {
            q = q.eq("category", mediaType);
        }

        const { data: results } = await q;

        return JSON.stringify({
            query,
            results: results ?? [],
            count: results?.length ?? 0,
        });
    },
});
