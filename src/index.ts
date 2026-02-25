// ─── Gravity Claw — Entry Point ──────────────────────────────────────
// Load config first (validates env vars), then DB, then all modules.

import { config } from "./config.js";

// Initialize database (auto-creates tables)
import "./db.js";

// Initialize knowledge graph (creates entity/relationship tables)
import "./knowledge_graph.js";

// Initialize self-evolving memory (adds tracking columns)
import "./memory_evolution.js";

// Register all tools (side-effect imports)
import "./tools/get_current_time.js";
import "./tools/linkedin_topics.js";
import "./tools/linkedin_templates.js";
import "./tools/linkedin_style.js";
import "./tools/memory.js";
import "./tools/profile.js";
import "./tools/onboarding.js";
import "./tools/markdown_memory.js";
import "./tools/knowledge_graph.js";
import "./tools/briefing.js";
import "./tools/scheduler_tools.js";
import "./tools/supabase_memory.js";
import "./tools/multimodal.js";
import "./tools/shell.js";
import "./tools/web_search.js";

import { bot } from "./bot.js";
import { startScheduler } from "./scheduler.js";
import { startHeartbeat } from "./heartbeat.js";

console.log("🪐 Gravity Claw");
console.log(`   Allowed users: [${config.allowedUserIds.join(", ")}]`);
console.log(`   Max agent iterations: ${config.maxAgentIterations}`);
console.log("");

// Start scheduled tasks (LinkedIn post delivery)
startScheduler();

// Start heartbeat system (morning briefing, background checks)
startHeartbeat();

console.log("");

// Start bot with long-polling (no web server, no exposed ports)
bot.start({
    onStart: (botInfo) => {
        console.log(`✅ Bot started: @${botInfo.username}`);
        console.log("   Listening for messages via long-polling...");
        console.log("   Press Ctrl+C to stop.\n");
    },
});

// Graceful shutdown
const shutdown = () => {
    console.log("\n🛑 Shutting down...");
    bot.stop();
    process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
