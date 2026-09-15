import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import { stringify } from "yaml";
import { defaultConfig } from "../../core/config/config.js";

const TEMPLATE_COMMENT = `# CodeGraph MCP configuration.
# See docs for full option reference.
`;

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Create a .codegraph.yml config file in the current project")
    .action(() => {
      const root = process.cwd();
      const configPath = join(root, ".codegraph.yml");
      if (existsSync(configPath)) {
        console.log(".codegraph.yml already exists, skipping.");
        return;
      }
      const projectName = root.split("/").filter(Boolean).pop() ?? "project";
      const cfg = defaultConfig(projectName);
      const yamlBody = stringify({
        project: { name: cfg.projectName },
        index: { roots: cfg.roots, ignore: [] },
        languages: { java: { enabled: true }, typescript: { enabled: true } },
        frameworks: { spring: { enabled: true }, react: { enabled: true } },
        query: cfg.query,
        storage: cfg.storage,
        security: { deny: [] },
      });
      writeFileSync(configPath, TEMPLATE_COMMENT + yamlBody, "utf-8");
      console.log(`Created ${configPath}`);
    });
}
