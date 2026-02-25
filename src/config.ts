import "dotenv/config";

export interface Config {
    telegramToken: string;
    anthropicKey: string;
    groqApiKey: string | undefined;
    allowedUserIds: number[];
    maxAgentIterations: number;
    supabaseUrl: string;
    supabaseKey: string;
}

function requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
        console.error(`❌ Missing required environment variable: ${name}`);
        console.error(`   Copy .env.example to .env and fill in your values.`);
        process.exit(1);
    }
    return value;
}

function parseUserIds(raw: string): number[] {
    const ids = raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map(Number);

    if (ids.some(isNaN)) {
        console.error("❌ ALLOWED_USER_IDS must be comma-separated numbers.");
        process.exit(1);
    }

    if (ids.length === 0) {
        console.error("❌ ALLOWED_USER_IDS must contain at least one user ID.");
        process.exit(1);
    }

    return ids;
}

export const config: Config = {
    telegramToken: requireEnv("TELEGRAM_BOT_TOKEN"),
    anthropicKey: requireEnv("ANTHROPIC_API_KEY"),
    groqApiKey: process.env.GROQ_API_KEY,
    allowedUserIds: parseUserIds(requireEnv("ALLOWED_USER_IDS")),
    maxAgentIterations: Number(process.env.MAX_AGENT_ITERATIONS) || 10,
    supabaseUrl: requireEnv("SUPABASE_URL"),
    supabaseKey: requireEnv("SUPABASE_KEY"),
};
