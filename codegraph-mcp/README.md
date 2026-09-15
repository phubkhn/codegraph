# CodeGraph MCP

Local-first code graph + MCP server for Java/Spring Boot and React/TypeScript
codebases. It scans your source, builds a graph of files/classes/methods/
components and their relationships (calls, REST endpoints, React
hooks/renders), stores it in a local SQLite file (`.codegraph/graph.db`), and
exposes three MCP tools so an AI coding agent (Claude Code) can query it
instead of grepping the repo.

This follows `codegraph-mcp-implementation-plan.md`: Milestones 1-3
(foundation, generic graph, MCP), **Phase 2 (Java/Spring depth)**, and
**Phase 3 (React depth)** are all done:

- **Phase 2**: constructor + `@Autowired` field injection, JPA entity graph
  (`@Entity` + `@OneToOne/@OneToMany/@ManyToOne/@ManyToMany`), repository
  generic-entity linking, Kafka producer/consumer graph, best-effort test
  mapping (`@Test`/`@SpringBootTest`/... class → subject class by naming
  convention), Lombok member synthesis (`@Data`/`@Value`/`@Getter`/`@Setter`/
  `@Builder`/`@SuperBuilder`/`@ToString`/`@EqualsAndHashCode`/`@Slf4j` and the
  other `@Log*` annotations — so a call through a Lombok-generated
  getter/setter/builder resolves instead of dead-ending), and Spring config
  binding (`@Value("${key}")` / `@ConfigurationProperties(prefix=...)` on a
  field resolves to a `CONFIG_PROPERTY` node parsed from
  `application*.properties`/`.yml`/`.yaml` or `bootstrap*.{properties,yml,yaml}`,
  with relaxed-binding key matching so `pool-size` in YAML and `poolSize` in
  Java converge on the same node).
- **Phase 3**: JSX prop names on render edges, frontend API-client detection
  (`fetch`/axios-shaped calls) that resolves to the **same shared node** as
  the matching Spring `REST_ENDPOINT` — so a full-stack trace from a
  react-router `<Route>` down to a `@Repository` method works in one
  `code_path` call — react-router `<Route>` mapping, and file-naming-based
  React test mapping.
- **Not implemented** (by design, lower priority per the plan): Redux/Context
  state-management flows, Feign/WebClient/Scheduler/Spring Batch/Redis.

See [Known limitations](docs/claude-code-integration.md#7-known-limitations)
for exactly what's modeled vs not, on both sides.

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

When `frameworks.spring` is enabled, `application*`/`bootstrap*`
`.properties`/`.yml`/`.yaml` files are also scanned (any other `.properties`/
`.yml`/`.yaml` file is discovered but parsed into zero nodes — only Spring's
own config-file naming convention is recognized) so `@Value("${key}")` /
`@ConfigurationProperties` bindings resolve to a real `CONFIG_PROPERTY` node.

`.gitignore` and `.codegraphignore` in the project root are honored
automatically, on top of the built-in ignore/deny lists (`node_modules`,
`target`, `build`, `dist`, `.git`, `.env*`, `*.pem`, `*.key`, ...).

## Graph model

- **Node types**: `FILE`, `CLASS`, `INTERFACE`, `ENUM`, `FUNCTION`, `METHOD`,
  `VARIABLE`, `REST_ENDPOINT`, `REACT_COMPONENT`, `REACT_HOOK`, `ENTITY`,
  `KAFKA_TOPIC`, `TEST`, `ROUTE`, `CONFIG_PROPERTY`.
- **Edge types**: `CONTAINS`, `IMPORTS`, `CALLS`, `EXTENDS`, `IMPLEMENTS`,
  `RENDERS` (carries `metadata.props`: JSX prop names), `USES_HOOK`,
  `DEPENDS_ON` (DI / JPA relationship / repository entity / config binding),
  `PRODUCES` / `CONSUMES` (Kafka), `TESTED_BY`, `MAPS_TO_ENDPOINT` (frontend
  API-client call → backend `REST_ENDPOINT`).
- Spring/React specifics live in node `metadata` (e.g.
  `springComponentType`, `httpMethod`, `path`, `framework`,
  `repositoryEntity`, `relationshipType`, `lombok`), not as new core concepts
  — the core graph stays framework-agnostic; `*-tags.ts` per language is the
  only place that knows about Spring/React annotations and conventions.
- A Lombok-synthesized member (`getX`/`setX`/`isX`/`builder`/`toString`/
  `equals`/`hashCode`/the `log` field) is a normal `METHOD`/`VARIABLE` node
  carrying `metadata.lombok: true` and `metadata.generatedFrom` (which
  annotation produced it) — everything that resolves against a real member
  (calls, `code_impact`, ...) works on it unchanged. A member the source
  already declares is never overridden by a synthesized one.
- `REST_ENDPOINT`, `KAFKA_TOPIC`, `ROUTE`, and `CONFIG_PROPERTY` nodes use a
  stable, qualifiedName-only id (not file/line-based) so the same
  route/topic/endpoint/property referenced from multiple files — a Kafka
  producer and its `@KafkaListener` consumer, or a React `fetch("/api/loans", ...)` call and
  the Spring `@PostMapping` that handles it — converges on one shared node
  instead of duplicating it. This is how the frontend and backend graphs join
  into one full-stack trace with no separate "integration" step.

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
npm test          # vitest — unit + integration tests: A->B->C call-graph fixture,
                   # Spring depth (DI/JPA/Kafka/tests), React depth (props/API client
                   # join/router/tests), and a basic Spring+React fullstack fixture
npm run build      # tsc
npm run dev        # tsc --watch
```
