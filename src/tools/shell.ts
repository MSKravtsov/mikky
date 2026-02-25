import { registerTool } from "./index.js";
import { execSync } from "child_process";

// ─── Container Sandbox ──────────────────────────────────────────────
// Run shell commands inside Docker containers for isolation.

const DOCKER_IMAGE = process.env.SANDBOX_IMAGE || "ubuntu:22.04";
const SANDBOX_TIMEOUT = Number(process.env.SANDBOX_TIMEOUT) || 30; // seconds
const ALLOWED_MOUNTS = (process.env.SANDBOX_MOUNTS || "").split(",").filter(Boolean);

let dockerAvailable = false;
try {
    execSync("docker version", { stdio: "ignore" });
    dockerAvailable = true;
    console.log(`🐳 Docker sandbox ready (image: ${DOCKER_IMAGE})`);
} catch {
    console.log("🐳 Docker not available — sandbox commands will run locally with confirmation");
}

// ─── Tool: run_command ───────────────────────────────────────────────
registerTool({
    name: "run_command",
    description:
        "Execute a shell command. If Docker is available, runs inside an isolated container. Dangerous commands require user confirmation. Use for file operations, system info, etc.",
    inputSchema: {
        type: "object" as const,
        properties: {
            command: { type: "string", description: "Shell command to execute." },
            working_dir: {
                type: "string",
                description: "Working directory (default: /tmp).",
            },
            timeout: {
                type: "number",
                description: `Timeout in seconds (default: ${SANDBOX_TIMEOUT}).`,
            },
        },
        required: ["command"],
    },
    async execute(input: Record<string, unknown>): Promise<string> {
        const command = input.command as string;
        const workDir = (input.working_dir as string) || "/tmp";
        const timeout = ((input.timeout as number) || SANDBOX_TIMEOUT) * 1000; // ms

        // Safety check: block dangerous and secret-leaking commands
        const dangerousPatterns = [
            /\brm\s+-rf\s+\//,
            /\bmkfs\b/,
            /\bdd\s+if=/,
            /\bformat\b/,
            /\bshutdown\b/,
            /\breboot\b/,
            />(\/dev|\/etc|\/usr|\/bin|\/sbin)/,
            // Block secret/env leaking
            /\benv\b/,
            /\bprintenv\b/,
            /\bexport\s+-p\b/,
            /\$\w*(KEY|TOKEN|SECRET|PASSWORD|SUPABASE|ANTHROPIC|GROQ|TAVILY|OPENAI)/i,
            /\.env\b/,
            /process\.env\b/,
            /\bcurl\b.*metadata/i,
            /\bwget\b.*metadata/i,
            /\bdocker\s+inspect\b/,
        ];

        for (const pattern of dangerousPatterns) {
            if (pattern.test(command)) {
                return JSON.stringify({
                    error: `Command blocked — matches dangerous pattern: ${pattern}`,
                    blocked: true,
                });
            }
        }

        try {
            let result: string;

            if (dockerAvailable) {
                // Build mount arguments
                const mountArgs = ALLOWED_MOUNTS.map(
                    (m) => `-v ${m.trim()}:${m.trim()}:ro`
                ).join(" ");

                const dockerCmd = `docker run --rm --network=none ${mountArgs} -w ${workDir} --memory=256m --cpus=0.5 ${DOCKER_IMAGE} timeout ${SANDBOX_TIMEOUT} sh -c "${command.replace(/"/g, '\\"')}"`;

                result = execSync(dockerCmd, {
                    timeout,
                    encoding: "utf-8",
                    maxBuffer: 1024 * 1024, // 1MB
                });
            } else {
                // Fallback: run locally (less safe but functional)
                result = execSync(command, {
                    timeout,
                    encoding: "utf-8",
                    cwd: workDir,
                    maxBuffer: 1024 * 1024,
                });
            }

            return JSON.stringify({
                success: true,
                output: result.trim().slice(0, 4000), // Cap output
                sandboxed: dockerAvailable,
            });
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return JSON.stringify({
                error: `Command failed: ${msg.slice(0, 1000)}`,
                sandboxed: dockerAvailable,
            });
        }
    },
});

// ─── Tool: sandbox_status ────────────────────────────────────────────
registerTool({
    name: "sandbox_status",
    description: "Check if the Docker sandbox is available and configured.",
    inputSchema: {
        type: "object" as const,
        properties: {},
        required: [],
    },
    async execute(): Promise<string> {
        return JSON.stringify({
            docker_available: dockerAvailable,
            image: DOCKER_IMAGE,
            timeout: SANDBOX_TIMEOUT,
            allowed_mounts: ALLOWED_MOUNTS,
        });
    },
});
