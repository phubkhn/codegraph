import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

export interface CodegraphConfig {
  projectName: string;
  roots: string[];
  ignore: string[];
  languages: {
    java: boolean;
    typescript: boolean;
  };
  frameworks: {
    spring: boolean;
    react: boolean;
  };
  query: {
    maxDepth: number;
    maxNodes: number;
    maxSourceLines: number;
  };
  storage: {
    path: string;
  };
  security: {
    deny: string[];
  };
}

export const DEFAULT_IGNORE = [
  "**/.git/**",
  "**/node_modules/**",
  "**/target/**",
  "**/build/**",
  "**/dist/**",
  "**/coverage/**",
  "**/.idea/**",
  "**/.vscode/**",
  "**/.codegraph/**",
];

export const DEFAULT_SECURITY_DENY = [
  "**/.env",
  "**/.env.*",
  "**/*.pem",
  "**/*.key",
  "**/*credentials*",
  "**/*secret*",
];

export function defaultConfig(projectName: string): CodegraphConfig {
  return {
    projectName,
    roots: ["."],
    ignore: DEFAULT_IGNORE,
    languages: { java: true, typescript: true },
    frameworks: { spring: true, react: true },
    query: { maxDepth: 4, maxNodes: 150, maxSourceLines: 400 },
    storage: { path: ".codegraph/graph.db" },
    security: { deny: DEFAULT_SECURITY_DENY },
  };
}

export function loadConfig(projectRoot: string): CodegraphConfig {
  const configPath = join(projectRoot, ".codegraph.yml");
  const base = defaultConfig(projectRoot.split("/").filter(Boolean).pop() ?? "project");
  if (!existsSync(configPath)) {
    return base;
  }
  const raw = parseYaml(readFileSync(configPath, "utf-8")) ?? {};
  return {
    projectName: raw.project?.name ?? base.projectName,
    roots: raw.index?.roots ?? base.roots,
    ignore: [...DEFAULT_IGNORE, ...(raw.index?.ignore ?? [])],
    languages: {
      java: raw.languages?.java?.enabled ?? base.languages.java,
      typescript: raw.languages?.typescript?.enabled ?? base.languages.typescript,
    },
    frameworks: {
      spring: raw.frameworks?.spring?.enabled ?? base.frameworks.spring,
      react: raw.frameworks?.react?.enabled ?? base.frameworks.react,
    },
    query: {
      maxDepth: raw.query?.maxDepth ?? base.query.maxDepth,
      maxNodes: raw.query?.maxNodes ?? base.query.maxNodes,
      maxSourceLines: raw.query?.maxSourceLines ?? base.query.maxSourceLines,
    },
    storage: { path: raw.storage?.path ?? base.storage.path },
    security: { deny: [...DEFAULT_SECURITY_DENY, ...(raw.security?.deny ?? [])] },
  };
}
