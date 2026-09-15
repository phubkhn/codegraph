import { Command } from "commander";
import { startMcpServer } from "../../mcp/server.js";

export function registerMcpCommand(program: Command): void {
  program
    .command("mcp")
    .description("Start the CodeGraph MCP server over stdio (for use by Claude Code / other MCP clients)")
    .action(async () => {
      await startMcpServer(process.env.CODEGRAPH_PROJECT_ROOT ?? process.cwd());
    });
}
