import { Command } from "commander";
import { createAppContext } from "../../core/app-context.js";
import { formatNodeRef } from "../../core/format.js";

export function registerSearchCommand(program: Command): void {
  program
    .command("search <symbol>")
    .description("Search for a symbol by name or qualified name")
    .action((symbol: string) => {
      const ctx = createAppContext(process.cwd());
      try {
        const results = ctx.queryService.searchSymbols(symbol, 25);
        if (results.length === 0) {
          console.log(`No matches for "${symbol}".`);
          return;
        }
        for (const n of results) console.log(formatNodeRef(n));
      } finally {
        ctx.close();
      }
    });
}
