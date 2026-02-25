// ─── Voice Message Transcription via Groq Whisper ───────────────────
import Groq from "groq-sdk";
import { config } from "./config.js";

let groqClient: Groq | null = null;

function getGroq(): Groq {
    if (!groqClient) {
        if (!config.groqApiKey) {
            throw new Error("GROQ_API_KEY is not configured.");
        }
        groqClient = new Groq({ apiKey: config.groqApiKey });
    }
    return groqClient;
}

/**
 * Download a Telegram voice file and transcribe it via Groq Whisper.
 *
 * @param fileUrl  Full download URL for the voice .ogg file
 * @returns        Transcribed text
 */
export async function transcribeVoice(fileUrl: string): Promise<string> {
    // 1. Download the .ogg voice file from Telegram
    const res = await fetch(fileUrl);
    if (!res.ok) {
        throw new Error(`Failed to download voice file: ${res.status} ${res.statusText}`);
    }

    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 2. Create a File object for the Groq SDK
    const file = new File([buffer], "voice.ogg", { type: "audio/ogg" });

    // 3. Transcribe via Groq Whisper
    const groq = getGroq();
    const transcription = await groq.audio.transcriptions.create({
        file,
        model: "whisper-large-v3-turbo",
        response_format: "text",
    });

    // The response is a plain string when response_format is "text"
    const text = (typeof transcription === "string"
        ? transcription
        : (transcription as unknown as { text: string }).text
    ).trim();

    if (!text) {
        throw new Error("Transcription returned empty text.");
    }

    return text;
}
