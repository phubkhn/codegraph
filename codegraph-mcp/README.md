# CodeGraph MCP

Local-first code graph + MCP server for Java/Spring Boot and React/TypeScript
codebases. It scans your source, builds a graph of files/classes/methods/
components and their relationships (calls, REST endpoints, React
hooks/renders), stores it in a local SQLite file (`.codegraph/graph.db`), and
exposes three MCP tools so an AI coding agent (Claude Code) can query it
instead of grepping the repo.

This follows `codegraph-mcp-implementation-plan.md`: Milestones 1-3
(foundation, generic graph, MCP) are done, and **Phase 2 (Java/Spring depth)**
is done — constructor + `@Autowired` field injection, JPA entity graph
(`@Entity` + `@OneToOne/@OneToMany/@ManyToOne/@ManyToMany`), repository
generic-entity linking, Kafka producer/consumer graph, and best-effort test
mapping (`@Test`/`@SpringBootTest`/... class → subject class by naming
convention). **Phase 3 (React depth — Router, Redux/state, deeper hook/prop
tracing, React test mapping)** is not started yet; React support today is the
lightweight component/hook/render tagging from the original V1 scope. See
[Known limitations](docs/claude-code-integration.md#known-limitations) for
exactly what's modeled vs not, on both sides.

## Quick start

```bash
npm install
npm run build
```

In a target project (Java Spring and/or React/TypeScript):

```bash
cd /path/to/your-project
node /path/to/codegraph-mcp/dist/cli/index.js init     # writes .codegraph.yml
node /path/to/codegraph-mcp/dist/cli/index.js index    # builds .codegraph/graph.db
node /path/to/codegraph-mcp/dist/cli/index.js status
```

Or install it once so the `codegraph` binary is on your PATH:

```bash
cd codegraph-mcp
npm run build
npm link          # exposes `codegraph` globally
cd /path/to/your-project
codegraph init
codegraph index
```

## CLI

| Command | Description |
|---|---|
| `codegraph init` | Write a default `.codegraph.yml` in the current project |
| `codegraph scan` | Report discovered/supported/ignored file counts (no parsing) |
| `codegraph index [--force]` | Parse + (re)build the graph, incrementally by default |
| `codegraph status` | Show file/node/edge counts and last index time |
| `codegraph search <symbol>` | Fuzzy-search symbols by name/qualified name |
| `codegraph explore <symbol> [--no-source]` | Symbol context: source, callers, callees, endpoints, hooks/renders |
| `codegraph impact <symbol> [--depth n]` | Everything that transitively depends on a symbol |
| `codegraph path <from> <to> [--depth n]` | Flow path between two symbols |
| `codegraph mcp` | Start the MCP server over stdio |

## Configuration (`.codegraph.yml`)

```yaml
project:
  name: payroll

index:
  roots: [backend, frontend]   # directories to scan, relative to project root
  ignore: []                   # extra glob patterns to ignore

languages:
  java: { enabled: true }
  typescript: { enabled: true }

frameworks:
  spring: { enabled: true }
  react: { enabled: true }

query:
  maxDepth: 4
  maxNodes: 150
  maxSourceLines: 400

storage:
  path: .codegraph/graph.db

security:
  deny: []   # extra glob patterns never indexed (on top of built-in .env/*.pem/*.key/etc.)
```

`.gitignore` and `.codegraphignore` in the project root are honored
automatically, on top of the built-in ignore/deny lists (`node_modules`,
`target`, `build`, `dist`, `.git`, `.env*`, `*.pem`, `*.key`, ...).

## Graph model

- **Node types**: `FILE`, `CLASS`, `INTERFACE`, `ENUM`, `FUNCTION`, `METHOD`,
  `VARIABLE`, `REST_ENDPOINT`, `REACT_COMPONENT`, `REACT_HOOK`, `ENTITY`,
  `KAFKA_TOPIC`, `TEST`.
- **Edge types**: `CONTAINS`, `IMPORTS`, `CALLS`, `EXTENDS`, `IMPLEMENTS`,
  `RENDERS`, `USES_HOOK`, `DEPENDS_ON` (DI / JPA relationship / repository
  entity), `PRODUCES` / `CONSUMES` (Kafka), `TESTED_BY`.
- Spring/React specifics live in node `metadata` (e.g.
  `springComponentType`, `httpMethod`, `path`, `framework`,
  `repositoryEntity`, `relationshipType`), not as new core concepts — the
  core graph stays framework-agnostic; `*-tags.ts` per language is the only
  place that knows about Spring/React annotations and conventions.
- `REST_ENDPOINT` and `KAFKA_TOPIC` nodes use a stable, qualifiedName-only id
  (not file/line-based) so a route/topic referenced from multiple files
  (e.g. a Kafka producer in one file and a `@KafkaListener` consumer in
  another) converges on one shared node instead of duplicating it.

## MCP tools

Once `codegraph mcp` is registered with an MCP client (see
[docs/claude-code-integration.md](docs/claude-code-integration.md)), three
tools are available:

- **`code_explore`** — find a symbol and return its location, source,
  callers/callees, related REST endpoints, hook usage, and rendered
  components.
- **`code_impact`** — reverse blast-radius analysis: everything that
  transitively depends on a symbol, grouped by kind (endpoints, components,
  methods, ...).
- **`code_path`** — find a call/render/hook/type path between two symbols
  (e.g. from a REST endpoint down to a repository method, or from a React
  page down to the backend endpoint it calls).

See [docs/claude-code-integration.md](docs/claude-code-integration.md) for
the full setup guide, hook example, and suggested `CLAUDE.md` rules.

## Development

```bash
npm test          # vitest — unit + integration tests, including the
                   # A->B->C call-graph fixture and a Spring+React fullstack fixture
npm run build      # tsc
npm run dev        # tsc --watch
```
