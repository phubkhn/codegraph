import { mkdtempSync, rmSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig, type CodegraphConfig } from "../src/core/config/config.js";
import { runIndex } from "../src/core/indexer.js";
import { SqliteGraphStore } from "../src/core/storage/sqlite-store.js";
import { GraphQueryService } from "../src/core/query/graph-query-service.js";

export interface TestProject {
  root: string;
  config: CodegraphConfig;
  store: SqliteGraphStore;
  queryService: GraphQueryService;
  cleanup(): void;
}

/** Copies a fixture directory into a scratch tmp dir, indexes it, and returns a ready-to-query store. */
export async function indexFixture(fixtureDir: string, configOverrides: Partial<CodegraphConfig> = {}): Promise<TestProject> {
  const root = mkdtempSync(join(tmpdir(), "codegraph-test-"));
  cpSync(fixtureDir, root, { recursive: true });

  const config: CodegraphConfig = { ...defaultConfig("test-project"), ...configOverrides };
  await runIndex(root, config, { force: true });

  const dbPath = join(root, config.storage.path);
  const store = new SqliteGraphStore(dbPath);
  const queryService = new GraphQueryService(store, config.query);

  return {
    root,
    config,
    store,
    queryService,
    cleanup: () => {
      store.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
