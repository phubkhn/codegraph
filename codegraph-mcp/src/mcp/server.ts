import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createAppContext } from "../core/app-context.js";
import { registerCodeExplore } from "./tools/code-explore.js";
import { registerCodeImpact } from "./tools/code-impact.js";
import { registerCodePath } from "./tools/code-path.js";

export async function startMcpServer(projectRoot: string): Promise<void> {
  const ctx = createAppContext(projectRoot);
  const server = new McpServer({ name: "codegraph-mcp", version: "0.1.0" });

  registerCodeExplore(server, ctx);
  registerCodeImpact(server, ctx);
  registerCodePath(server, ctx);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const shutdown = () => {
    ctx.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
