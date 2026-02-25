import Anthropic from "@anthropic-ai/sdk";
import { chat, type Message } from "./llm.js";
import { getAllTools, getTool } from "./tools/index.js";
import { config } from "./config.js";
import { getContextManager } from "./context.js";

export async function runAgent(userMessage: string): Promise<string> {
    const tools = getAllTools();
    const contextManager = await getContextManager();

    // Add to context manager history
    contextManager.addMessage("user", userMessage);

    // Auto-prune if approaching token limits
    if (contextManager.needsPruning()) {
        await contextManager.prune();
    }

    // Build messages from context history
    const messages: Message[] = contextManager.getMessages();

    let iterations = 0;

    while (iterations < config.maxAgentIterations) {
        iterations++;

        const response = await chat(messages, tools);

        // Check if the model wants to use tools
        const toolUseBlocks = response.content.filter(
            (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
        );

        // No tool calls — extract final text and return
        if (toolUseBlocks.length === 0) {
            const textBlocks = response.content.filter(
                (block): block is Anthropic.TextBlock => block.type === "text"
            );
            const finalText =
                textBlocks.map((b) => b.text).join("\n") || "(no response)";

            // Add assistant response to context
            contextManager.addMessage("assistant", finalText);
            return finalText;
        }

        // Append assistant message with tool-use blocks
        messages.push({ role: "assistant", content: response.content });

        // Execute each tool and build tool results
        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        for (const toolUse of toolUseBlocks) {
            const tool = getTool(toolUse.name);

            let result: string;
            if (!tool) {
                result = JSON.stringify({ error: `Unknown tool: ${toolUse.name}` });
            } else {
                try {
                    console.log(`  🔧 Tool: ${toolUse.name}`);
                    result = await tool.execute(
                        toolUse.input as Record<string, unknown>
                    );
                } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    result = JSON.stringify({
                        error: `Tool execution failed: ${msg}`,
                    });
                    console.error(`  ❌ Tool ${toolUse.name} failed:`, msg);
                }
            }

            toolResults.push({
                type: "tool_result",
                tool_use_id: toolUse.id,
                content: result,
            });
        }

        // Append tool results as a user message
        messages.push({ role: "user", content: toolResults });
    }

    // Safety limit reached
    console.warn(
        `⚠️ Agent loop hit max iterations (${config.maxAgentIterations})`
    );
    return "I'm sorry, I got stuck in a loop. Please try rephrasing your question.";
}
