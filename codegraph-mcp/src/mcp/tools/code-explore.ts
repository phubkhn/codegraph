import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppContext } from "../../core/app-context.js";
import { buildExploreContext } from "../../core/context/context-builder.js";
import { formatExploreResult } from "../../core/format.js";

export const codeExploreInputShape = {
  query: z.string().describe("Symbol name, qualified name, or fuzzy search text (e.g. 'LoanService.calculateInterest')"),
  includeSource: z.boolean().optional().describe("Include the symbol's source code (default true)"),
  maxSourceLines: z.number().int().positive().optional().describe("Cap on how many source lines to include"),
};

export function registerCodeExplore(server: McpServer, ctx: AppContext): void {
  server.registerTool(
    "code_explore",
    {
      title: "Explore code symbol",
      description:
        "Find a symbol (class, method, function, REST endpoint, React component/hook) and return its location, source, callers, callees, and related endpoints/components from the local code graph.",
      inputSchema: codeExploreInputShape,
    },
    async ({ query, includeSource, maxSourceLines }) => {
      const contexts = await buildExploreContext(query, ctx.projectRoot, ctx.queryService, {
        includeSource: includeSource ?? true,
        maxSourceLines: maxSourceLines ?? ctx.config.query.maxSourceLines,
      });
      return { content: [{ type: "text", text: formatExploreResult(contexts) }] };
    },
  );
}
