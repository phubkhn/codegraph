import { Command } from "commander";
import { createAppContext } from "../../core/app-context.js";
import { formatPathResult } from "../../core/format.js";

export function registerPathCommand(program: Command): void {
  program
    .command("path <from> <to>")
    .description("Find a flow path between two symbols")
    .option("--depth <n>", "Max traversal depth", (v) => parseInt(v, 10))
    .action((from: string, to: string, opts: { depth?: number }) => {
      const ctx = createAppContext(process.cwd());
      try {
        const fromNode = ctx.queryService.resolveSymbol(from);
        const toNode = ctx.queryService.resolveSymbol(to);
        if (!fromNode || !toNode) {
          const missing = [!fromNode ? `"${from}"` : null, !toNode ? `"${to}"` : null].filter(Boolean).join(" and ");
          console.log(`Could not resolve ${missing} to a known symbol.`);
          return;
        }
        const result = ctx.queryService.findPath(fromNode.id, toNode.id, opts.depth ?? ctx.config.query.maxDepth);
        console.log(formatPathResult(result, fromNode.qualifiedName, toNode.qualifiedName));
      } finally {
        ctx.close();
      }
    });
}
