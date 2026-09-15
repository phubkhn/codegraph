import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppContext } from "../../core/app-context.js";
import { formatPathResult } from "../../core/format.js";

export const codePathInputShape = {
  from: z.string().describe("Starting symbol name or qualified name (e.g. an endpoint, component, or method)"),
  to: z.string().describe("Target symbol name or qualified name"),
  depth: z.number().int().positive().optional().describe("Max traversal depth (default from .codegraph.yml)"),
};

export function registerCodePath(server: McpServer, ctx: AppContext): void {
  server.registerTool(
    "code_path",
    {
      title: "Find flow path between two symbols",
      description:
        "Find a call/render/hook/type path between two symbols through the code graph (e.g. from a React route/component to a Spring repository method), to trace a full-stack flow.",
      inputSchema: codePathInputShape,
    },
    async ({ from, to, depth }) => {
      const fromNode = ctx.queryService.resolveSymbol(from);
      const toNode = ctx.queryService.resolveSymbol(to);
      if (!fromNode || !toNode) {
        const missing = [!fromNode ? `"${from}"` : null, !toNode ? `"${to}"` : null].filter(Boolean).join(" and ");
        return { content: [{ type: "text", text: `Could not resolve ${missing} to a known symbol.` }] };
      }
      const result = ctx.queryService.findPath(fromNode.id, toNode.id, depth ?? ctx.config.query.maxDepth);
      return { content: [{ type: "text", text: formatPathResult(result, fromNode.qualifiedName, toNode.qualifiedName) }] };
    },
  );
}
