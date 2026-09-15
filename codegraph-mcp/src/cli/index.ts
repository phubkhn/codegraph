#!/usr/bin/env node
import { Command } from "commander";
import { registerInitCommand } from "./commands/init.js";
import { registerScanCommand } from "./commands/scan.js";
import { registerIndexCommand } from "./commands/index-project.js";
import { registerStatusCommand } from "./commands/status.js";
import { registerSearchCommand } from "./commands/search.js";
import { registerExploreCommand } from "./commands/explore.js";
import { registerImpactCommand } from "./commands/impact.js";
import { registerPathCommand } from "./commands/path.js";
import { registerMcpCommand } from "./commands/mcp.js";

const program = new Command();
program.name("codegraph").description("Local-first code graph for Java/Spring and React/TypeScript").version("0.1.0");

registerInitCommand(program);
registerScanCommand(program);
registerIndexCommand(program);
registerStatusCommand(program);
registerSearchCommand(program);
registerExploreCommand(program);
registerImpactCommand(program);
registerPathCommand(program);
registerMcpCommand(program);

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
