import { join } from "node:path";
import { loadConfig, type CodegraphConfig } from "./config/config.js";
import { SqliteGraphStore } from "./storage/sqlite-store.js";
import { GraphQueryService } from "./query/graph-query-service.js";

export interface AppContext {
  projectRoot: string;
  config: CodegraphConfig;
  store: SqliteGraphStore;
  queryService: GraphQueryService;
  close(): void;
}

export function createAppContext(projectRoot: string): AppContext {
  const config = loadConfig(projectRoot);
  const dbPath = join(projectRoot, config.storage.path);
  const store = new SqliteGraphStore(dbPath);
  const queryService = new GraphQueryService(store, config.query);
  return {
    projectRoot,
    config,
    store,
    queryService,
    close: () => store.close(),
  };
}
