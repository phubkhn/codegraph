import { Command } from "commander";
import { createAppContext } from "../../core/app-context.js";

export function registerStatusCommand(program: Command): void {
  program
    .command("status")
    .description("Show current graph size and last index time")
    .action(() => {
      const ctx = createAppContext(process.cwd());
      try {
        const status = ctx.store.getStatus();
        console.log(`Project           : ${ctx.config.projectName}`);
        console.log(`Files indexed     : ${status.files}`);
        console.log(`Nodes             : ${status.nodes}`);
        console.log(`Edges             : ${status.edges}`);
        console.log(`Last index        : ${status.lastIndexedAt ?? "(never)"}`);
      } finally {
        ctx.close();
      }
    });
}
