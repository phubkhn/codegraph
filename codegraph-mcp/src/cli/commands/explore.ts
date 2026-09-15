import { Command } from "commander";
import { createAppContext } from "../../core/app-context.js";
import { buildExploreContext } from "../../core/context/context-builder.js";
import { formatExploreResult } from "../../core/format.js";

export function registerExploreCommand(program: Command): void {
  program
    .command("explore <symbol>")
    .description("Show a symbol's source, callers, callees, and related endpoints/components")
    .option("--no-source", "Omit source code from the output")
    .action(async (symbol: string, opts: { source: boolean }) => {
      const ctx = createAppContext(process.cwd());
      try {
        const contexts = await buildExploreContext(symbol, ctx.projectRoot, ctx.queryService, {
          includeSource: opts.source,
          maxSourceLines: ctx.config.query.maxSourceLines,
        });
        console.log(formatExploreResult(contexts));
      } finally {
        ctx.close();
      }
    });
}
