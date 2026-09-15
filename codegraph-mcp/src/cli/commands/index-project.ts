import { Command } from "commander";
import { loadConfig } from "../../core/config/config.js";
import { runIndex } from "../../core/indexer.js";

export function registerIndexCommand(program: Command): void {
  program
    .command("index")
    .description("Parse the project and (re)build the code graph, incrementally by default")
    .option("--force", "Re-index every file, ignoring content hashes")
    .action(async (opts: { force?: boolean }) => {
      const root = process.cwd();
      const config = loadConfig(root);
      const summary = await runIndex(root, config, { force: opts.force, onProgress: (msg) => console.log(msg) });
      console.log("");
      console.log(`Files parsed          : ${summary.filesParsed}`);
      console.log(`Files unchanged        : ${summary.filesSkippedUnchanged}`);
      console.log(`Files deleted           : ${summary.filesDeleted}`);
      console.log(`Files failed to parse  : ${summary.filesFailed}`);
      console.log(`Nodes written          : ${summary.nodesWritten}`);
      console.log(`Edges written          : ${summary.edgesWritten}`);
      console.log(`Duration               : ${summary.durationMs}ms`);
    });
}
