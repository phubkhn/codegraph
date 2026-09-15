import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppContext } from "../../core/app-context.js";
import { formatImpactResult } from "../../core/format.js";

export const codeImpactInputShape = {
  symbol: z.string().describe("Symbol name or qualified name to analyze (e.g. 'LoanService.calculateInterest')"),
  depth: z.number().int().positive().optional().describe("Max traversal depth (default from .codegraph.yml, typically 4)"),
};

export function registerCodeImpact(server: McpServer, ctx: AppContext): void {
  server.registerTool(
    "code_impact",
    {
      title: "Impact / blast-radius analysis",
      description:
        "Given a symbol, find everything that transitively depends on it (callers, endpoints, React components, tests-in-future) via reverse graph traversal. Use before changing shared code to see the blast radius.",
      inputSchema: codeImpactInputShape,
    },
    async ({ symbol, depth }) => {
      const node = ctx.queryService.resolveSymbol(symbol);
      if (!node) {
        return { content: [{ type: "text", text: `No symbol found matching "${symbol}".` }] };
      }
      const result = ctx.queryService.impactAnalysis(node.id, depth ?? ctx.config.query.maxDepth);
      if (!result) {
        return { content: [{ type: "text", text: `No symbol found matching "${symbol}".` }] };
      }
      return { content: [{ type: "text", text: formatImpactResult(result) }] };
    },
  );
}
