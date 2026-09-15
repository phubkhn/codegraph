import { Command } from "commander";
import { createAppContext } from "../../core/app-context.js";
import { formatImpactResult } from "../../core/format.js";

export function registerImpactCommand(program: Command): void {
  program
    .command("impact <symbol>")
    .description("Show everything that transitively depends on a symbol")
    .option("--depth <n>", "Max traversal depth", (v) => parseInt(v, 10))
    .action((symbol: string, opts: { depth?: number }) => {
      const ctx = createAppContext(process.cwd());
      try {
        const node = ctx.queryService.resolveSymbol(symbol);
        if (!node) {
          console.log(`No symbol found matching "${symbol}".`);
          return;
        }
        const result = ctx.queryService.impactAnalysis(node.id, opts.depth ?? ctx.config.query.maxDepth);
        if (result) console.log(formatImpactResult(result));
      } finally {
        ctx.close();
      }
    });
}
