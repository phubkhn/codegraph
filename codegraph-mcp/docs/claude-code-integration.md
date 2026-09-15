# Applying CodeGraph MCP to a Claude Code project (SDLC guide)

This guide wires the CodeGraph MCP server into a Java Spring / React
TypeScript project so Claude Code can use `code_explore`, `code_impact`, and
`code_path` instead of grepping the repo — and keeps the graph fresh
automatically via a session hook.

## 1. Build the MCP server once

```bash
cd codegraph-mcp
npm install
npm run build
```

This produces `dist/cli/index.js`. You can either reference that path
directly (works from any machine that has this repo checked out) or
`npm link` it so the `codegraph` binary is on your `PATH`. The examples below
use the direct path so they work without any global install step.

## 2. Initialize and index the target project

In the Java Spring / React project you want Claude Code to work in:

```bash
cd /path/to/your-project
node /path/to/codegraph-mcp/dist/cli/index.js init
```

Edit the generated `.codegraph.yml` if your backend/frontend live in
non-default subfolders, e.g.:

```yaml
index:
  roots: [backend, frontend]
```

Then build the first graph:

```bash
node /path/to/codegraph-mcp/dist/cli/index.js index
node /path/to/codegraph-mcp/dist/cli/index.js status
```

Re-indexing is incremental (hash-based) and fast — only changed files are
re-parsed. Add `.codegraph/` to `.gitignore` (the graph is a local artifact,
not something to commit).

## 3. Register the MCP server with Claude Code

Create (or edit) `.mcp.json` at the project root:

```json
{
  "mcpServers": {
    "codegraph": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/codegraph-mcp/dist/cli/index.js", "mcp"],
      "env": {
        "CODEGRAPH_PROJECT_ROOT": "/path/to/your-project"
      }
    }
  }
}
```

`.mcp.json` is meant to be checked in so the whole team gets it; use an
absolute path for `codegraph-mcp` since it's not (yet) published to a
registry. Restart Claude Code (or run `/mcp` to reconnect) after adding this.

## 4. Keep the graph fresh with a `SessionStart` hook

Add this to `.claude/settings.json` (checked in) so every new Claude Code
session re-indexes automatically before doing anything else. Plain stdout
from a `SessionStart` hook is injected directly into Claude's context, so
this also doubles as a short "codegraph is available" reminder:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup",
        "hooks": [
          {
            "type": "command",
            "command": "node /path/to/codegraph-mcp/dist/cli/index.js index 2>&1 | tail -5 && echo 'CodeGraph MCP is indexed and available: use code_explore/code_impact/code_path instead of broad grep/glob searches for call graphs, REST endpoint tracing, and blast-radius analysis.'",
            "timeout": 60000
          }
        ]
      }
    ]
  }
}
```

Because indexing is incremental, this stays fast after the first run. If
your repo is large, run the first `codegraph index` manually (step 2) so the
hook only ever has small incremental work to do at session start.

## 5. Teach Claude *when* to use it — `CLAUDE.md` rules

Add a section like this to the project's `CLAUDE.md` so the agent reaches
for the graph instead of ad-hoc grepping:

```markdown
## Code intelligence (CodeGraph MCP)

This project has a local code graph MCP server (`codegraph`) with three
tools. Prefer them over broad grep/glob searches for anything relational:

- **Before changing a shared method, service, repository, or REST
  endpoint**: call `code_impact` on it first to see the blast radius
  (affected controllers, services, endpoints, React components) before
  editing.
- **Before implementing a change from a requirement/ticket**: call
  `code_explore` on the symbol(s) named in the ticket to see its current
  source, callers, callees, and related REST endpoint/tests — do this
  before writing an implementation plan.
- **To understand a full-stack flow** ("how does creating a loan work?"):
  call `code_path` from the React route/component/API call down to the
  Spring controller/service/repository method, or vice versa.
- **After finishing an implementation**: re-run `code_impact` on the
  symbols you changed and confirm every affected caller/endpoint/component
  listed was actually updated or is still compatible.
- If a tool returns "no symbol found" the graph may be stale — run
  `node /path/to/codegraph-mcp/dist/cli/index.js index` and retry before
  falling back to grep.
```

This mirrors the Impact Analysis / Implementation / Review / Test Selection
workflow from `codegraph-mcp-implementation-plan.md` §11-14. Test selection
now has real signal on the Java/Spring side: `code_impact` groups affected
`TEST` nodes (matched to their subject class by naming convention, e.g.
`LoanServiceTest` → `LoanService`) directly in its output — see §7 below for
what's modeled and what's still naming-convention-only.

## 6. Suggested SDLC workflow

```
Requirement / ticket
   |
   v
code_explore <symbol named in the ticket>      # locate current implementation
   |
   v
code_impact <symbol>                            # blast radius: BE/FE/endpoints
   |
   v
Implementation plan (write this out before editing)
   |
   v
Implement the change
   |
   v
code_impact <changed symbols>                   # confirm nothing was missed, incl. affected tests
   |
   v
Run the tests code_impact flagged as affected on both sides — Java/Spring
tests via `@Test`/`@SpringBootTest`/... class → subject class TESTED_BY
edges, React tests via `X.test.tsx` → `X` file-naming TESTED_BY edges.
```

## 7. Known limitations

CodeGraph MCP has done Milestones 1-3, **Phase 2 (Java/Spring depth)**, and
**Phase 3 (React depth)** in full — see `codegraph-mcp-implementation-plan.md`
for the complete roadmap and what's intentionally out of scope (Redux/state
management, Feign/WebClient/Scheduler). Calibrate trust in the graph
accordingly:

- **Call resolution is best-effort, not a compiler.** Java: constructor/field
  type-based resolution, same-package resolution, plus a "unique name in
  project" fallback. TypeScript: same-file, then relative-import resolution,
  then a unique-name fallback. Ambiguous calls (multiple same-named
  methods/functions in the project) are silently **not** wired into an edge
  rather than guessed — a `code_impact` or `code_path` miss can mean
  "ambiguous", not "no relationship."
- **Java/Spring — modeled (Phase 2 done):** constructor injection,
  `@Autowired` field injection, JPA entity graph (`@Entity` +
  `@OneToOne`/`@OneToMany`/`@ManyToOne`/`@ManyToMany`, collection element
  type via generics), repository → entity linking (`JpaRepository<Entity,
  Id>`), Kafka producer (`KafkaTemplate.send("topic", ...)` with a literal
  topic string) / consumer (`@KafkaListener`) graph converging on one shared
  topic node, and best-effort test mapping (`@Test`/`@SpringBootTest`/
  `@WebMvcTest`/`@DataJpaTest` class → subject class by `XTest`/`XIT` naming
  convention).
- **Java/Spring — still not modeled:** setter injection (only constructor
  params + `@Autowired` fields), `@Qualifier`-based disambiguation, dynamic
  Kafka topic expressions (non-literal `.send(...)` args are skipped, not
  guessed), Feign/WebClient/RestTemplate/Spring Batch/Scheduler/Redis.
- **React — modeled (Phase 3 done):** component/hook tagging, render tree
  (`RENDERS`, with prop names in `metadata.props`), hook usage (`USES_HOOK`),
  plain function calls (`CALLS`), react-router mapping to a `ROUTE` node —
  both the JSX `<Route path="..." element={<X/>}>` (v6) / `component={X}`
  (v5) style and the v6.4+ data-router `createBrowserRouter([{ path,
  element }, ...])` object-config style (including nested `children`
  arrays, though a nested child's path isn't joined with its parent's
  prefix) — frontend API-client detection (`fetch(...)` and any
  `xxx.get/post/put/patch/delete(url, ...)` call — axios, a custom wrapper,
  no specific library required, a leading `` `${BASE_URL}/...` `` template
  prefix is stripped rather than treated as a path segment) that **joins the
  same shared node** as the matching Spring `REST_ENDPOINT` when both sides
  are indexed, and file-naming-based test mapping (`LoanForm.test.tsx` →
  `LoanForm`, TESTED_BY the file itself since JS tests are `describe`/`it`
  blocks, not classes). Verified end-to-end (route → page → hook → API
  client → shared `REST_ENDPOINT` → controller method) against an
  unmodified real-world Spring Boot + React repo, not just hand-written
  fixtures.
- **React — still not modeled:** Redux/Context/state-management flows
  (`useSelector`/`dispatch`); a `createBrowserRouter` call passed a
  separately-declared `routes` variable instead of an inline array literal
  isn't traced; the FE↔BE endpoint join still requires the path to match
  exactly after normalization — a `${id}`/`:id`-shaped template segment
  normalizes to the same `{param}` Spring uses, but a non-literal HTTP
  method or a query string appended to the path won't match.
- **Object-literal exports aren't parsed** (e.g. `export const api = { get:
  ... }`) — only top-level `function`/`class`/`const () => {}` declarations
  and class methods are indexed. A common `api.get(...)` client pattern will
  only resolve if `api` methods are individual named exports, not object
  properties — this also means an API client built as `export const api = {
  get: (url) => fetch(url) }` won't be detected (the `fetch` call is inside
  an object property, not a tracked top-level function).
- **Cross-file staleness on rename/delete**: incremental indexing only
  re-resolves the files it re-parses; a caller in an *unchanged* file that
  used to point at a since-renamed symbol in a *changed* file can go stale
  until `codegraph index --force`. A Kafka topic/REST endpoint/route node's
  displayed `file`/`line` reflects whichever file was indexed most recently
  among the files that reference it — cosmetic only, doesn't affect edges.
- **Default `maxDepth` (4) can be too shallow for a full-stack trace.**
  Route → page → hook → API client → endpoint → controller → service →
  repository is easily 6+ hops. `code_path`/`code_impact` accept an explicit
  `depth` argument — raise it for full-stack queries rather than assuming "no
  path" means "no relationship."

None of this blocks the core value (call graphs, REST endpoint tracing, DI/
JPA/Kafka graphs on the Java side, React component/hook/route/API-client
tracing, full-stack blast-radius analysis) — it just means the graph is a
strong hint, not ground truth. Always verify with `code_explore`'s source
output before assuming a wiring is complete.

## Troubleshooting

```bash
# Check graph size / freshness
node /path/to/codegraph-mcp/dist/cli/index.js status

# Full rebuild (fixes staleness after big refactors/renames)
node /path/to/codegraph-mcp/dist/cli/index.js index --force

# Sanity-check a symbol resolves at all
node /path/to/codegraph-mcp/dist/cli/index.js search "SomeSymbolName"
```

If `code_explore`/`code_impact`/`code_path` return "no symbol found," the
query almost always needs to be closer to the qualified name shown by
`search` (e.g. `com.example.loan.LoanService.disburse` rather than just
`disburse` if multiple methods share that name).
