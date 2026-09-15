import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import type { EdgeType, GraphEdge, GraphNode, NodeType } from "../model/types.js";

// Imported via require() instead of a static ESM import: node:sqlite is a newer builtin that
// some bundlers/test runners (e.g. Vite's SSR resolver) don't yet recognize as a Node builtin,
// which makes them try to bundle it as a package named "sqlite" and fail. require() bypasses that.
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: typeof DatabaseSyncType };

const SCHEMA = `
CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,
    language TEXT,
    hash TEXT,
    indexed_at TEXT
);

CREATE TABLE IF NOT EXISTS nodes (
    id TEXT PRIMARY KEY,
    file_id TEXT NOT NULL,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    qualified_name TEXT NOT NULL,
    start_line INTEGER,
    end_line INTEGER,
    metadata TEXT
);

CREATE TABLE IF NOT EXISTS edges (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    target TEXT NOT NULL,
    type TEXT NOT NULL,
    metadata TEXT
);

CREATE INDEX IF NOT EXISTS idx_nodes_name ON nodes(name);
CREATE INDEX IF NOT EXISTS idx_nodes_qualified_name ON nodes(qualified_name);
CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type);
CREATE INDEX IF NOT EXISTS idx_nodes_file_id ON nodes(file_id);
CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source);
CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target);
CREATE INDEX IF NOT EXISTS idx_edges_type ON edges(type);
`;

export interface FileRecord {
  path: string;
  language: string;
  hash: string;
  indexedAt: string;
}

export interface GraphStatus {
  files: number;
  nodes: number;
  edges: number;
  lastIndexedAt: string | null;
}

interface NodeRow {
  id: string;
  file_id: string;
  type: string;
  name: string;
  qualified_name: string;
  start_line: number | null;
  end_line: number | null;
  metadata: string | null;
}

interface EdgeRow {
  id: string;
  source: string;
  target: string;
  type: string;
  metadata: string | null;
}

export class SqliteGraphStore {
  private readonly db: DatabaseSyncType;

  constructor(dbPath: string) {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  getFileRecord(relPath: string): FileRecord | undefined {
    const row = this.db.prepare("SELECT * FROM files WHERE path = ?").get(relPath) as
      | { path: string; language: string; hash: string; indexed_at: string }
      | undefined;
    if (!row) return undefined;
    return { path: row.path, language: row.language, hash: row.hash, indexedAt: row.indexed_at };
  }

  listFiles(): FileRecord[] {
    const rows = this.db.prepare("SELECT * FROM files").all() as Array<{
      path: string;
      language: string;
      hash: string;
      indexed_at: string;
    }>;
    return rows.map((r) => ({ path: r.path, language: r.language, hash: r.hash, indexedAt: r.indexed_at }));
  }

  upsertFile(relPath: string, language: string, hash: string): void {
    this.db
      .prepare(
        `INSERT INTO files (id, path, language, hash, indexed_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET language = excluded.language, hash = excluded.hash, indexed_at = excluded.indexed_at`,
      )
      .run(relPath, relPath, language, hash, new Date().toISOString());
  }

  /** Removes a file's row and every node/edge that belongs to it (cascade by node id). */
  deleteFileGraph(relPath: string): void {
    const nodeIds = (this.db.prepare("SELECT id FROM nodes WHERE file_id = ?").all(relPath) as Array<{ id: string }>).map(
      (r) => r.id,
    );
    const tx = this.db;
    tx.exec("BEGIN");
    try {
      for (const id of nodeIds) {
        tx.prepare("DELETE FROM edges WHERE source = ? OR target = ?").run(id, id);
      }
      tx.prepare("DELETE FROM nodes WHERE file_id = ?").run(relPath);
      tx.prepare("DELETE FROM files WHERE path = ?").run(relPath);
      tx.exec("COMMIT");
    } catch (err) {
      tx.exec("ROLLBACK");
      throw err;
    }
  }

  insertNodes(nodes: GraphNode[]): void {
    if (nodes.length === 0) return;
    const stmt = this.db.prepare(
      `INSERT INTO nodes (id, file_id, type, name, qualified_name, start_line, end_line, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET file_id=excluded.file_id, type=excluded.type, name=excluded.name,
         qualified_name=excluded.qualified_name, start_line=excluded.start_line, end_line=excluded.end_line,
         metadata=excluded.metadata`,
    );
    this.db.exec("BEGIN");
    try {
      for (const n of nodes) {
        stmt.run(
          n.id,
          n.file,
          n.type,
          n.name,
          n.qualifiedName,
          n.startLine ?? null,
          n.endLine ?? null,
          n.metadata ? JSON.stringify(n.metadata) : null,
        );
      }
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  insertEdges(edges: GraphEdge[]): void {
    if (edges.length === 0) return;
    const stmt = this.db.prepare(
      `INSERT INTO edges (id, source, target, type, metadata) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET source=excluded.source, target=excluded.target, type=excluded.type, metadata=excluded.metadata`,
    );
    this.db.exec("BEGIN");
    try {
      for (const e of edges) {
        stmt.run(e.id, e.source, e.target, e.type, e.metadata ? JSON.stringify(e.metadata) : null);
      }
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  allNodes(): GraphNode[] {
    const rows = this.db.prepare("SELECT * FROM nodes").all() as unknown as NodeRow[];
    return rows.map(rowToNode);
  }

  getNode(id: string): GraphNode | undefined {
    const row = this.db.prepare("SELECT * FROM nodes WHERE id = ?").get(id) as unknown as NodeRow | undefined;
    return row ? rowToNode(row) : undefined;
  }

  searchSymbols(query: string, limit = 25): GraphNode[] {
    const like = `%${query}%`;
    const rows = this.db
      .prepare(
        `SELECT * FROM nodes
         WHERE qualified_name = ? OR name = ? OR qualified_name LIKE ? OR name LIKE ?
         ORDER BY
           CASE
             WHEN qualified_name = ? THEN 0
             WHEN name = ? THEN 1
             WHEN qualified_name LIKE ? THEN 2
             ELSE 3
           END
         LIMIT ?`,
      )
      .all(query, query, like, like, query, query, `${query}%`, limit) as unknown as NodeRow[];
    return rows.map(rowToNode);
  }

  getNodesByQualifiedName(qualifiedName: string): GraphNode[] {
    const rows = this.db.prepare("SELECT * FROM nodes WHERE qualified_name = ?").all(qualifiedName) as unknown as NodeRow[];
    return rows.map(rowToNode);
  }

  getEdgesFrom(nodeId: string, types?: EdgeType[]): GraphEdge[] {
    const rows = types?.length
      ? (this.db
          .prepare(`SELECT * FROM edges WHERE source = ? AND type IN (${types.map(() => "?").join(",")})`)
          .all(nodeId, ...types) as unknown as EdgeRow[])
      : (this.db.prepare("SELECT * FROM edges WHERE source = ?").all(nodeId) as unknown as EdgeRow[]);
    return rows.map(rowToEdge);
  }

  getEdgesTo(nodeId: string, types?: EdgeType[]): GraphEdge[] {
    const rows = types?.length
      ? (this.db
          .prepare(`SELECT * FROM edges WHERE target = ? AND type IN (${types.map(() => "?").join(",")})`)
          .all(nodeId, ...types) as unknown as EdgeRow[])
      : (this.db.prepare("SELECT * FROM edges WHERE target = ?").all(nodeId) as unknown as EdgeRow[]);
    return rows.map(rowToEdge);
  }

  getStatus(): GraphStatus {
    const files = (this.db.prepare("SELECT COUNT(*) as c FROM files").get() as { c: number }).c;
    const nodes = (this.db.prepare("SELECT COUNT(*) as c FROM nodes").get() as { c: number }).c;
    const edges = (this.db.prepare("SELECT COUNT(*) as c FROM edges").get() as { c: number }).c;
    const last = this.db.prepare("SELECT MAX(indexed_at) as m FROM files").get() as { m: string | null };
    return { files, nodes, edges, lastIndexedAt: last.m };
  }
}

function rowToNode(row: NodeRow): GraphNode {
  return {
    id: row.id,
    type: row.type as NodeType,
    name: row.name,
    qualifiedName: row.qualified_name,
    file: row.file_id,
    startLine: row.start_line ?? undefined,
    endLine: row.end_line ?? undefined,
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
  };
}

function rowToEdge(row: EdgeRow): GraphEdge {
  return {
    id: row.id,
    source: row.source,
    target: row.target,
    type: row.type as EdgeType,
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
  };
}
