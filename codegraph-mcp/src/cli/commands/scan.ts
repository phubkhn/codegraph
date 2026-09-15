import { Command } from "commander";
import { loadConfig } from "../../core/config/config.js";
import { scanProject } from "../../core/scanner/file-scanner.js";

export function registerScanCommand(program: Command): void {
  program
    .command("scan")
    .description("Scan the project and report discovered/supported/ignored file counts (no parsing/indexing)")
    .action(async () => {
      const root = process.cwd();
      const config = loadConfig(root);
      const result = await scanProject(root, config);
      console.log(`Files discovered : ${result.filesDiscovered}`);
      console.log(`Supported        : ${result.filesSupported}`);
      console.log(`Ignored          : ${result.filesIgnored}`);
    });
}
