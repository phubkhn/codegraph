# CodeGraph MCP - Implementation Plan

## 1. Mục tiêu

Xây dựng một MCP riêng dùng cho AI Harness để phân tích source code và cung cấp code context theo dạng graph.

MCP cần hỗ trợ theo 3 phase chính:

1. **Base CodeGraph MCP** - xây dựng graph engine và MCP generic.
2. **Java Spring Intelligence** - hiểu kiến trúc và flow của Java/Spring Boot.
3. **React Intelligence** - hiểu component, hook, route và API call của React.

Target cuối cùng:

```text
Source Code
   |
   v
Parser Layer
   |
   v
Code Graph Builder
   |
   v
Graph Storage
   |
   v
Query Engine
   |
   v
MCP Server
   |
   v
AI Harness / Claude Code / Agent
```

MCP không cần clone toàn bộ chức năng của CodeGraph. V1 chỉ tập trung trả lời tốt các câu hỏi:

1. Code nằm ở đâu?
2. Symbol này gọi symbol nào?
3. Symbol này bị gọi bởi đâu?
4. Nếu sửa symbol này thì cái gì có thể bị ảnh hưởng?
5. API Spring này chạy qua những component nào?
6. React page/component này gọi API backend nào?
7. User flow đi từ UI -> API -> service -> repository/event như thế nào?

---

# 2. Tech Stack đề xuất

```text
Runtime       : Node.js
Language      : TypeScript
Parser        : Tree-sitter
Storage       : SQLite
MCP           : Model Context Protocol SDK
Test          : Vitest
CLI           : Commander.js hoặc tương đương
Logging       : Pino hoặc tương đương
```

Lý do chọn TypeScript:

- MCP ecosystem tốt.
- Tree-sitter integration dễ.
- Phù hợp cho developer tooling.
- Không phụ thuộc runtime của application được scan.
- Có thể scan Java/Kotlin/React mà không cần build application.

---

# 3. Repository Structure

```text
company-codegraph-mcp/
|
+-- src/
|   +-- core/
|   |   +-- model/
|   |   |   +-- graph-node.ts
|   |   |   +-- graph-edge.ts
|   |   |   +-- parsed-file.ts
|   |   |   +-- node-type.ts
|   |   |   +-- edge-type.ts
|   |   |
|   |   +-- scanner/
|   |   |   +-- file-scanner.ts
|   |   |   +-- ignore-resolver.ts
|   |   |
|   |   +-- parser/
|   |   |   +-- language-parser.ts
|   |   |   +-- parser-registry.ts
|   |   |
|   |   +-- graph/
|   |   |   +-- graph-builder.ts
|   |   |   +-- graph-service.ts
|   |   |
|   |   +-- storage/
|   |   |   +-- graph-repository.ts
|   |   |   +-- sqlite-graph-repository.ts
|   |   |   +-- migrations/
|   |   |
|   |   +-- resolver/
|   |   |   +-- symbol-resolver.ts
|   |   |
|   |   +-- query/
|   |   |   +-- graph-query-service.ts
|   |   |   +-- impact-service.ts
|   |   |   +-- path-service.ts
|   |   |
|   |   +-- context/
|   |       +-- context-builder.ts
|   |
|   +-- languages/
|   |   +-- java/
|   |   |   +-- java-parser.ts
|   |   |   +-- java-symbol-resolver.ts
|   |   |   +-- spring/
|   |   |       +-- spring-component-detector.ts
|   |   |       +-- spring-endpoint-detector.ts
|   |   |       +-- spring-repository-detector.ts
|   |   |       +-- spring-entity-detector.ts
|   |   |       +-- spring-kafka-detector.ts
|   |   |
|   |   +-- javascript/
|   |       +-- typescript-parser.ts
|   |       +-- react/
|   |           +-- react-component-detector.ts
|   |           +-- react-hook-detector.ts
|   |           +-- react-router-detector.ts
|   |           +-- react-api-detector.ts
|   |
|   +-- mcp/
|   |   +-- server.ts
|   |   +-- tools/
|   |       +-- code-explore.ts
|   |       +-- code-impact.ts
|   |       +-- code-path.ts
|   |
|   +-- cli/
|       +-- index.ts
|       +-- commands/
|           +-- init.ts
|           +-- index-project.ts
|           +-- status.ts
|           +-- search.ts
|           +-- explore.ts
|
+-- tests/
|   +-- unit/
|   +-- integration/
|   +-- fixtures/
|
+-- examples/
|   +-- base-project/
|   +-- spring-project/
|   +-- react-project/
|
+-- docs/
|   +-- architecture.md
|   +-- graph-model.md
|   +-- mcp-tools.md
|
+-- package.json
+-- tsconfig.json
+-- README.md
```

---

# 4. Core Graph Model

## 4.1 Node Types

Phase đầu support:

```text
FILE
MODULE
CLASS
INTERFACE
ENUM
FUNCTION
METHOD
VARIABLE
```

Framework-specific node bổ sung sau:

```text
REST_ENDPOINT
SPRING_BEAN
ENTITY
KAFKA_TOPIC
REACT_COMPONENT
REACT_HOOK
ROUTE
API_ENDPOINT
```

## 4.2 Edge Types

```text
CONTAINS
IMPORTS
CALLS
EXTENDS
IMPLEMENTS
REFERENCES
DEPENDS_ON
TESTED_BY
RENDERS
USES_HOOK
PASSES_PROP
PRODUCES
CONSUMES
MAPS_TO_ENDPOINT
```

## 4.3 Node Model

```typescript
export interface GraphNode {
  id: string;
  type: NodeType;
  name: string;
  qualifiedName?: string;
  file: string;
  startLine?: number;
  endLine?: number;
  metadata?: Record<string, unknown>;
}
```

## 4.4 Edge Model

```typescript
export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: EdgeType;
  metadata?: Record<string, unknown>;
}
```

Nguyên tắc:

```text
Core Graph không biết Spring.
Core Graph không biết React.

Framework-specific data đặt trong metadata hoặc semantic layer.
```

---

# 5. PHASE 1 - Base CodeGraph MCP

## Goal

Tạo MCP generic có thể:

```text
scan source
-> parse
-> build graph
-> store graph
-> query graph
-> trả code context cho agent
```

---

## Step 1.1 - Bootstrap Repository

### Tasks

- Initialize Node.js + TypeScript project.
- Setup ESLint.
- Setup Prettier.
- Setup Vitest.
- Setup basic logging.
- Setup CLI entrypoint.

### Deliverable

```bash
npm install
npm run build
npm test
```

đều chạy thành công.

### DoD

- [ ] TypeScript compile thành công.
- [ ] Unit test chạy được.
- [ ] CLI hello-world chạy được.

---

## Step 1.2 - Define Graph Domain Model

### Tasks

Implement:

```text
GraphNode
GraphEdge
ParsedFile
NodeType
EdgeType
```

### Deliverable

Domain model không phụ thuộc parser/storage/framework.

### DoD

- [ ] Graph model có unit tests.
- [ ] Core layer không import Spring/React code.

---

## Step 1.3 - Parser Abstraction

Define interface:

```typescript
export interface LanguageParser {
  supports(filePath: string): boolean;

  parse(filePath: string, source: string): Promise<ParsedFile>;
}
```

Implement ParserRegistry:

```text
ParserRegistry
   |
   +-- JavaParser
   +-- TypeScriptParser
   +-- JavaScriptParser
```

Phase 1 có thể dùng một parser đơn giản hoặc fixture parser để hoàn thiện architecture trước.

### DoD

- [ ] Có thể register parser.
- [ ] Có thể resolve parser từ file extension.
- [ ] Không parser -> skip an toàn.

---

## Step 1.4 - File Scanner

### Features

Scan project directory.

Ignore mặc định:

```text
.git
node_modules
target
build
dist
coverage
.idea
.vscode
```

Support:

```text
.gitignore
.codegraphignore
```

### API

```typescript
scan(root: string): Promise<ScannedFile[]>
```

### CLI

```bash
codegraph scan .
```

Output ví dụ:

```text
Files discovered : 1,542
Supported        : 1,210
Ignored          : 332
```

### DoD

- [ ] Scan recursive.
- [ ] Honor ignore rules.
- [ ] Không scan binary file.

---

## Step 1.5 - SQLite Storage

Database location:

```text
<project>/.codegraph/graph.db
```

Schema tối thiểu:

```sql
CREATE TABLE files (
    id TEXT PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,
    language TEXT,
    hash TEXT,
    indexed_at TEXT
);

CREATE TABLE nodes (
    id TEXT PRIMARY KEY,
    file_id TEXT,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    qualified_name TEXT,
    start_line INTEGER,
    end_line INTEGER,
    metadata TEXT
);

CREATE TABLE edges (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    target TEXT NOT NULL,
    type TEXT NOT NULL,
    metadata TEXT
);
```

Indexes:

```text
nodes.name
nodes.qualified_name
nodes.type
edges.source
edges.target
edges.type
```

### DoD

- [ ] Insert/update nodes.
- [ ] Insert/update edges.
- [ ] Query by symbol.
- [ ] Delete graph data by file.

---

## Step 1.6 - Incremental Indexing

Không rebuild toàn bộ project nếu file không thay đổi.

Flow:

```text
scan file
   |
   v
calculate hash
   |
   +-- unchanged -> skip
   |
   +-- changed
          |
          v
    delete old nodes/edges
          |
          v
         parse
          |
          v
       save graph
```

CLI:

```bash
codegraph index
codegraph index --force
```

### DoD

- [ ] File unchanged không parse lại.
- [ ] File changed được re-index.
- [ ] File deleted được remove khỏi graph.

---

## Step 1.7 - Graph Query Engine

Implement tối thiểu:

```typescript
searchSymbols(query)
getNode(id)
getCallers(symbol)
getCallees(symbol)
getDependencies(symbol)
getDependents(symbol)
findPath(from, to)
impactAnalysis(symbol, depth)
```

### Impact Algorithm V1

BFS theo reverse relationship.

Default relationship:

```text
CALLS
DEPENDS_ON
IMPLEMENTS
EXTENDS
REFERENCES
```

### DoD

- [ ] Search symbol.
- [ ] Caller/callee.
- [ ] Path query.
- [ ] Depth-limited impact.
- [ ] Prevent infinite graph traversal.

---

## Step 1.8 - Source Context Builder

Graph chỉ chỉ ra relationship. Agent cần source thực tế.

Input:

```text
LoanService.calculateInterest
```

Output:

```text
Symbol
Location
Source code
Callers
Callees
Dependencies
```

Ví dụ:

```text
Symbol:
LoanService.calculateInterest

Location:
src/main/java/.../LoanService.java:44-72

Callers:
- LoanProcessor.process
- DisbursementService.execute

Callees:
- InterestCalculator.calculate
```

Sau đó append source lines.

### Important

Giới hạn context:

```text
max depth
max symbols
max source lines
max files
```

để tránh MCP trả về quá nhiều token.

---

## Step 1.9 - Build MCP Server

MCP V1 expose 3 tools.

### Tool: code_explore

```json
{
  "query": "LoanService.calculateInterest",
  "depth": 2,
  "includeSource": true
}
```

Purpose:

```text
search
+
symbol context
+
caller/callee
+
source
```

### Tool: code_impact

```json
{
  "symbol": "LoanService.calculateInterest",
  "depth": 3
}
```

### Tool: code_path

```json
{
  "from": "LoanController.create",
  "to": "LoanRepository.save"
}
```

### DoD

- [ ] MCP server start được.
- [ ] Claude Code connect được.
- [ ] Agent gọi `code_explore` được.
- [ ] Output deterministic và có giới hạn.

---

## Step 1.10 - CLI

Commands:

```bash
codegraph init
codegraph scan
codegraph index
codegraph index --force
codegraph status
codegraph search <symbol>
codegraph explore <symbol>
codegraph impact <symbol>
codegraph path <from> <to>
codegraph mcp
```

### Example

```bash
codegraph status
```

Output:

```text
Project           : payroll-service
Files indexed     : 1,234
Nodes             : 13,524
Edges             : 34,285
Last index        : 2026-09-14 22:10:10
```

---

## Step 1.11 - Integration Test

Fixture:

```text
A.foo()
   |
   v
B.bar()
   |
   v
C.baz()
```

Tests:

```text
search B.bar

callers(B.bar)
=> A.foo

callees(B.bar)
=> C.baz

path(A.foo, C.baz)
=> A.foo -> B.bar -> C.baz

impact(C.baz)
=> B.bar -> A.foo
```

---

## Phase 1 - Definition of Done

- [ ] Scan source project.
- [ ] Parse source thông qua parser abstraction.
- [ ] Persist graph vào SQLite.
- [ ] Incremental indexing.
- [ ] Symbol search.
- [ ] Caller/callee.
- [ ] Path query.
- [ ] Impact analysis.
- [ ] Source context builder.
- [ ] MCP chạy được.
- [ ] Claude/Harness gọi được MCP.

Output cuối phase:

```text
Generic CodeGraph MCP usable
```

---

# 6. PHASE 2 - Java Spring Intelligence

## Goal

Biến graph generic thành graph hiểu Java/Spring Boot.

Target flow:

```text
HTTP Endpoint
   |
   v
Controller
   |
   v
Service
   |
   v
Domain Service
   |
   v
Repository
   |
   +--> Entity
   |
   +--> Kafka topic
```

---

## Step 2.1 - Java Tree-sitter Parser

Extract:

```text
package
import
class
interface
enum
field
constructor
method
method call
annotation
```

Relations:

```text
CONTAINS
IMPORTS
EXTENDS
IMPLEMENTS
CALLS
```

Example:

```java
class LoanService implements LoanProcessor {
}
```

Graph:

```text
LoanService
   |
   +-- IMPLEMENTS --> LoanProcessor
```

---

## Step 2.2 - Java Symbol Resolver

Resolve:

```java
loanService.process();
```

to:

```text
com.company.loan.LoanService.process
```

Resolution order:

1. Local variable type.
2. Method parameter type.
3. Class field type.
4. Explicit import.
5. Same package.
6. Wildcard import.
7. Best-effort name search.

### Important

Không cần build Java compiler.

Mục tiêu:

```text
resolve tốt common Spring code
```

Không cần 100% compile-semantic correctness cho V1.

---

## Step 2.3 - Spring Bean Detection

Detect:

```text
@RestController
@Controller
@Service
@Component
@Repository
@Configuration
```

Store metadata:

```json
{
  "framework": "spring",
  "componentType": "service"
}
```

---

## Step 2.4 - Dependency Injection

Priority support:

### V1

Constructor injection.

```java
@Service
class LoanService {
    private final InterestService interestService;
}
```

Graph:

```text
LoanService
   |
   +-- DEPENDS_ON --> InterestService
```

### V2

Support:

```text
@Autowired constructor
@Autowired field
@Qualifier
```

---

## Step 2.5 - REST Endpoint Extraction

Detect:

```text
@RequestMapping
@GetMapping
@PostMapping
@PutMapping
@PatchMapping
@DeleteMapping
```

Example:

```java
@RequestMapping("/api/loans")
class LoanController {

    @PostMapping("/{id}/disburse")
    void disburse() {}
}
```

Node:

```text
POST /api/loans/{id}/disburse
```

Graph:

```text
REST_ENDPOINT
POST /api/loans/{id}/disburse
          |
          v
LoanController.disburse
```

---

## Step 2.6 - Repository Intelligence

Support:

```text
JpaRepository
CrudRepository
PagingAndSortingRepository
@Repository
```

Example:

```java
interface LoanRepository
    extends JpaRepository<Loan, Long> {
}
```

Graph:

```text
LoanRepository
      |
      +-- DEPENDS_ON --> Loan
```

Metadata:

```json
{
  "repository": true,
  "entity": "Loan"
}
```

---

## Step 2.7 - JPA Entity Graph

Detect:

```text
@Entity
@Table
@Id
@OneToOne
@OneToMany
@ManyToOne
@ManyToMany
```

Example:

```text
Loan
  |
  +-- MANY_TO_ONE --> Customer
```

Use-case:

```text
Impact DB/domain model analysis
```

---

## Step 2.8 - Kafka Intelligence

Producer detection:

```text
KafkaTemplate.send(...)
```

Consumer detection:

```text
@KafkaListener
```

Graph:

```text
DisbursementService
      |
      +-- PRODUCES --> loan.disbursed

loan.disbursed
      |
      +-- CONSUMED_BY --> AccountingListener
```

Nếu topic expression dynamic, mark:

```json
{
  "resolution": "partial"
}
```

---

## Step 2.9 - Spring Tests Mapping

Detect:

```text
@Test
@SpringBootTest
@WebMvcTest
@DataJpaTest
@MockBean
```

Graph:

```text
LoanService
    |
    +-- TESTED_BY --> LoanServiceTest
```

Best-effort mapping bằng:

```text
class name
imports
mocked dependencies
method calls
```

---

## Step 2.10 - Spring Flow Query

Add semantic query:

```text
findEndpoint
traceEndpoint
findSpringBean
findConsumers
findProducers
```

Example:

```text
trace endpoint:
POST /api/loans/{id}/disburse
```

Expected:

```text
POST /api/loans/{id}/disburse
      |
      v
LoanController.disburse
      |
      v
DisbursementService.execute
      |
      v
LoanRepository.save
      |
      v
Kafka: loan.disbursed
```

---

## Step 2.11 - Spring Impact Analysis

Input:

```text
LoanService.calculateInterest
```

Expected output grouping:

```text
Affected endpoints
Affected controllers
Affected services
Affected repositories
Affected entities
Affected Kafka topics
Affected consumers
Affected tests
```

Example:

```text
Affected endpoints:
- POST /api/loans/calculate
- POST /api/loans/disburse

Affected services:
- LoanProcessor
- DisbursementService

Affected tests:
- LoanServiceTest
- DisbursementFlowIT
```

---

## Phase 2 - Definition of Done

- [ ] Java parsing.
- [ ] Java symbol resolution.
- [ ] Spring component detection.
- [ ] Constructor injection graph.
- [ ] REST endpoint graph.
- [ ] Repository graph.
- [ ] JPA entity graph.
- [ ] Kafka producer/consumer graph.
- [ ] Test mapping.
- [ ] Endpoint tracing.
- [ ] Spring-aware impact analysis.

Output cuối phase:

```text
Backend Intelligence MCP usable cho Java Spring
```

---

# 7. PHASE 3 - React Intelligence

## Goal

MCP hiểu flow frontend:

```text
Route
  |
  v
Page
  |
  v
Component
  |
  v
Custom Hook
  |
  v
API Client
  |
  v
Backend endpoint
```

---

## Step 3.1 - TypeScript / JavaScript Parser

Support:

```text
.ts
.tsx
.js
.jsx
```

Extract:

```text
import
export
function
arrow function
class
variable
function call
JSX element
```

---

## Step 3.2 - React Component Detection

Detect:

```tsx
function LoanPage() {}
```

and:

```tsx
const LoanPage = () => {}
```

Mark metadata:

```json
{
  "framework": "react",
  "type": "component"
}
```

---

## Step 3.3 - Component Hierarchy

Example:

```tsx
<LoanPage>
  <LoanForm />
  <LoanTable />
</LoanPage>
```

Graph:

```text
LoanPage
   |
   +-- RENDERS --> LoanForm
   |
   +-- RENDERS --> LoanTable
```

---

## Step 3.4 - Props Relations

Example:

```tsx
<LoanForm loan={loan} />
```

Graph metadata:

```text
LoanPage
   |
   +-- PASSES_PROP --> LoanForm.loan
```

Không cần resolve expression sâu ở V1.

---

## Step 3.5 - Hook Detection

Built-in:

```text
useState
useEffect
useMemo
useCallback
useContext
```

Custom hooks:

```text
useLoan
useCreateLoan
useCustomer
```

Graph:

```text
LoanPage
   |
   +-- USES_HOOK --> useLoan
```

---

## Step 3.6 - Custom Hook Call Graph

Example:

```tsx
const loan = useLoan(id);
```

Trace:

```text
LoanPage
   |
   v
useLoan
   |
   v
loanApi.getLoan
```

---

## Step 3.7 - API Client Detection

Priority:

```text
fetch
axios
custom API wrapper
```

Example:

```typescript
api.post('/api/loans', payload)
```

Graph:

```text
loanApi.create
     |
     +-- MAPS_TO_ENDPOINT --> POST /api/loans
```

Store:

```text
HTTP method
URL/path
source symbol
```

---

## Step 3.8 - Router Mapping

Support React Router first.

Example:

```text
/loans/:id
   |
   v
LoanDetailPage
```

Graph:

```text
ROUTE
  |
  v
PAGE
```

---

## Step 3.9 - State Management

V1 chọn một hoặc hai framework phổ biến.

Recommended priority:

```text
Redux Toolkit
React Context
Zustand
```

Example Redux flow:

```text
Component
   |
   +-- USES_SELECTOR --> selector

Component
   |
   +-- DISPATCHES --> action
          |
          v
        reducer
```

State management không block React V1. Có thể implement sau route/API flow.

---

## Step 3.10 - React Test Mapping

Support:

```text
Vitest
Jest
React Testing Library
```

Graph:

```text
LoanForm
   |
   +-- TESTED_BY --> LoanForm.test.tsx
```

---

## Step 3.11 - React Flow Query

Input:

```text
trace route /loans
```

Output:

```text
Route /loans
   |
   v
LoanPage
   |
   v
LoanTable
   |
   v
useLoans
   |
   v
loanApi.getLoans
   |
   v
GET /api/loans
```

---

## Phase 3 - Definition of Done

- [ ] TS/JS parser.
- [ ] React component detection.
- [ ] Component hierarchy.
- [ ] Custom hook graph.
- [ ] Route mapping.
- [ ] API client mapping.
- [ ] Test mapping.
- [ ] UI -> API trace.

Output cuối phase:

```text
Frontend Intelligence MCP usable cho React
```

---

# 8. Integration Milestone - Full Stack Graph

Sau Phase 3, nối React endpoint với Spring endpoint.

Matching key:

```text
HTTP Method + normalized URL
```

Example:

Frontend:

```text
POST /api/loans
```

Backend:

```text
POST /api/loans
```

Join graph:

```text
Route /loans/new
      |
      v
LoanForm
      |
      v
useCreateLoan
      |
      v
loanApi.create
      |
      v
POST /api/loans
      |
      v
LoanController.create
      |
      v
LoanService.create
      |
      v
LoanRepository.save
```

### Normalization cần support

```text
/api/loans/${id}
/api/loans/:id
/api/loans/{id}
```

normalize thành:

```text
/api/loans/{param}
```

---

# 9. MCP Contract cuối cùng

Giữ tool surface nhỏ.

## 9.1 code_explore

Purpose:

```text
Tìm symbol và trả context liên quan.
```

Input:

```json
{
  "query": "LoanService.calculateInterest",
  "depth": 2,
  "includeSource": true
}
```

Output group:

```text
Matched symbols
Source
Callers
Callees
Dependencies
Related endpoints
Related tests
```

---

## 9.2 code_impact

Purpose:

```text
Blast radius / impact analysis.
```

Input:

```json
{
  "symbol": "LoanService.calculateInterest",
  "depth": 3
}
```

Output:

```text
Backend impacted
Frontend impacted
API impacted
DB/domain impacted
Events impacted
Tests impacted
```

---

## 9.3 code_path

Purpose:

```text
Tìm flow giữa 2 point.
```

Input:

```json
{
  "from": "/loans/new",
  "to": "LoanRepository.save"
}
```

Output:

```text
/loans/new
  -> LoanPage
  -> LoanForm
  -> useCreateLoan
  -> POST /api/loans
  -> LoanController.create
  -> LoanService.create
  -> LoanRepository.save
```

---

# 10. Harness Integration

Khuyến nghị MCP là repository/service riêng.

```text
company-codegraph-mcp
```

Harness chỉ consume MCP.

```text
company-ai-harness/
|
+-- agents/
|   +-- architect.md
|   +-- developer.md
|   +-- reviewer.md
|   +-- tester.md
|
+-- skills/
|   +-- requirement-analysis/
|   +-- impact-analysis/
|   +-- implementation/
|   +-- code-review/
|   +-- verification/
|
+-- hooks/
|
+-- rules/
|
+-- integrations/
    +-- codegraph.md
```

Architecture:

```text
                 AI Harness
                     |
      +--------------+--------------+
      |              |              |
      v              v              v
   Jira MCP       Docs MCP     CodeGraph MCP
                                      |
                                      v
                                Source Code
```

---

# 11. Harness Skill - Impact Analysis

Suggested workflow:

```text
Jira / Requirement
      |
      v
Understand requirement
      |
      v
code_explore
      |
      v
Locate current implementation
      |
      v
code_impact
      |
      v
Identify affected areas
      |
      +-- backend
      +-- frontend
      +-- API
      +-- DB/domain
      +-- Kafka/event
      +-- tests
      |
      v
Implementation Plan
```

Output của skill:

```markdown
## Impact Analysis

### Backend
- ...

### Frontend
- ...

### API
- ...

### Data / Entity
- ...

### Kafka/Event
- ...

### Tests
- ...

### Risks
- ...
```

---

# 12. Harness Skill - Implementation

```text
Requirement
   |
   v
Read implementation plan
   |
   v
code_explore
   |
   v
Verify current code
   |
   v
Implement
   |
   v
Run affected tests
   |
   v
code_impact changed symbols
   |
   v
Check missing change
```

---

# 13. Harness Skill - Code Review

```text
Changed Files
    |
    v
Extract changed symbols
    |
    v
code_impact
    |
    v
Check blast radius
    |
    +-- missing caller update
    +-- missing API change
    +-- missing test
    +-- broken FE/BE contract
    |
    v
Review result
```

---

# 14. Harness Skill - Test Selection

```text
Changed symbols
     |
     v
code_impact
     |
     v
TESTED_BY edges
     |
     v
Affected tests
     |
     v
Execute tests
```

Long term có thể chia test thành:

```text
unit
integration
controller
repository
frontend component
E2E
```

---

# 15. Configuration

File:

```text
.codegraph.yml
```

Example:

```yaml
project:
  name: payroll

index:
  roots:
    - backend
    - frontend

  ignore:
    - "**/target/**"
    - "**/node_modules/**"
    - "**/dist/**"

languages:
  java:
    enabled: true

  typescript:
    enabled: true

frameworks:
  spring:
    enabled: true

  react:
    enabled: true

query:
  maxDepth: 4
  maxNodes: 100
  maxSourceLines: 500

storage:
  path: .codegraph/graph.db
```

---

# 16. MCP Configuration Example

Example generic configuration:

```json
{
  "mcpServers": {
    "codegraph": {
      "command": "node",
      "args": [
        "/path/to/company-codegraph-mcp/dist/mcp/server.js"
      ],
      "env": {
        "CODEGRAPH_PROJECT_ROOT": "/path/to/project"
      }
    }
  }
}
```

Nếu package CLI:

```json
{
  "mcpServers": {
    "codegraph": {
      "command": "company-codegraph",
      "args": ["mcp"],
      "env": {
        "CODEGRAPH_PROJECT_ROOT": "/path/to/project"
      }
    }
  }
}
```

---

# 17. Suggested Implementation Order

Không làm theo framework ngay từ đầu.

Implement theo milestone:

## Milestone 1 - Foundation

```text
Project bootstrap
Graph model
Parser abstraction
File scanner
SQLite storage
```

## Milestone 2 - Generic Graph

```text
Graph builder
Incremental indexing
Search
Caller/callee
Path
Impact
```

## Milestone 3 - MCP

```text
Context builder
code_explore
code_impact
code_path
Claude integration
```

Sau milestone này MCP đã usable.

## Milestone 4 - Java

```text
Tree-sitter Java
Class/method/import
Method call
Symbol resolver
```

## Milestone 5 - Spring

```text
Beans
DI
REST endpoint
Repository
Entity
Kafka
Tests
```

## Milestone 6 - React

```text
TS/TSX parser
Component
Hook
Route
API client
Tests
```

## Milestone 7 - Full Stack

```text
React API endpoint
     <->
Spring REST endpoint
```

## Milestone 8 - Harness

```text
Impact skill
Implementation skill
Review skill
Test selection skill
```

---

# 18. Prioritization

## Must Have

```text
Graph model
SQLite
Incremental index
Java parsing
Method calls
Caller/callee
REST endpoint
React API mapping
MCP tools
```

## Should Have

```text
Spring DI
Repository
JPA Entity
Custom React Hooks
React Router
Test mapping
Kafka
```

## Nice to Have

```text
Graph UI
Visual diagram
Advanced type inference
Runtime graph
Git history integration
Coverage integration
Multi-repo graph
```

Không làm Nice-to-Have trước khi MCP được dùng thật trong Harness.

---

# 19. Testing Strategy

## Unit tests

Test từng component:

```text
parser
resolver
storage
query
normalizer
framework detector
```

## Fixture projects

### Fixture 1 - Basic Java

```text
Controller -> Service -> Repository
```

### Fixture 2 - Spring

```text
REST
-> Controller
-> Service
-> Repository
-> Entity
-> Kafka
```

### Fixture 3 - React

```text
Route
-> Page
-> Component
-> Hook
-> API
```

### Fixture 4 - Full stack

```text
React
-> REST
-> Spring
-> Repository
```

## Golden Tests

Query:

```text
How does creating a loan work?
```

Expected path phải chứa:

```text
LoanForm
useCreateLoan
POST /api/loans
LoanController.create
LoanService.create
LoanRepository.save
```

Golden tests rất quan trọng để tránh graph quality bị degrade khi thay parser/resolver.

---

# 20. Quality Metrics

Không chỉ đo code coverage.

Theo dõi:

```text
Symbol extraction accuracy
Call resolution rate
Endpoint resolution rate
FE-BE endpoint matching rate
Impact precision
Impact recall
Average graph query latency
Index duration
Incremental index duration
MCP token output
```

Ví dụ target ban đầu:

```text
Java symbols         > 95%
Spring endpoint      > 95%
Common method call   > 85%
React API mapping    > 90%
Incremental index    < 2s cho 1-5 file thay đổi
Common MCP query     < 1s sau khi indexed
```

Đây là target engineering, cần benchmark lại bằng codebase thật.

---

# 21. Non-Goals V1

Không implement:

```text
Full Java compiler semantic model
100% accurate polymorphic dispatch
Runtime tracing
Graph UI
Cloud backend
Telemetry platform
Multi-language support ngoài Java/TS
IDE plugin
Automatic code modification
Vector DB
LLM-generated graph
```

Graph nên được build deterministic từ source code.

LLM chỉ sử dụng graph, không phải nguồn chính để sinh graph.

---

# 22. Security

MCP dùng trong enterprise nên mặc định:

```text
Local-first
No source upload
No telemetry by default
Read-only source access
DB stored locally
Path boundary enforcement
Ignore secrets
```

Không index:

```text
.env
credentials
private key
secret files
```

Có config deny list.

Example:

```yaml
security:
  deny:
    - "**/.env*"
    - "**/*.pem"
    - "**/*.key"
    - "**/credentials*"
```

---

# 23. Logging

Log cần có:

```text
index started
index completed
files parsed
files skipped
parse failures
unresolved references
query latency
MCP invocation
```

Không log source code mặc định.

---

# 24. Error Handling

Parser fail một file không được fail toàn project.

```text
File parse error
      |
      +--> log warning
      +--> mark file status = failed
      +--> continue indexing
```

MCP query nếu graph thiếu dữ liệu cần trả:

```text
resolutionConfidence: low|medium|high
```

hoặc note rõ unresolved relationship.

---

# 25. Future Extensions

Sau khi Harness sử dụng ổn định mới cân nhắc:

```text
Kotlin
Gradle dependency graph
Maven dependency graph
OpenAPI
GraphQL
Feign Client
WebClient
RestTemplate
Spring Batch
Scheduler
Redis
Database table lineage
SQL query mapping
Kafka Schema Registry
Git diff aware impact
Coverage aware test selection
Multi-repository graph
Architecture rule validation
```

Đặc biệt cho Java enterprise, các extension đáng ưu tiên:

```text
Feign
WebClient
Kafka
JPA
Scheduler
Spring Batch
Redis
```

---

# 26. Recommended First Release Scope

## V0.1

```text
Base graph
SQLite
Java class/method
CALLS
Caller/callee
MCP code_explore
```

## V0.2

```text
Spring Controller
Service
Repository
REST Endpoint
code_path
code_impact
```

## V0.3

```text
Entity
Kafka
Tests
```

## V0.4

```text
React component
Hook
Route
API client
```

## V0.5

```text
React -> Spring full-stack flow
```

## V1.0

```text
Harness integration
Impact Analysis skill
Implementation skill
Review skill
Test Selection skill
Benchmark completed
Documentation completed
```

---

# 27. Final Definition of Done

MCP được coi là hoàn thành V1 khi một agent trong Harness có thể nhận requirement như:

```text
Change interest calculation when customer performs early repayment.
```

và sử dụng MCP để tự tìm được:

```text
Affected API
Affected React screen
Affected component/hook
Affected Controller
Affected Service
Affected domain logic
Affected Repository/Entity
Affected Kafka events
Affected tests
```

Sau đó tạo được implementation plan dựa trên source thật.

Target flow cuối:

```text
Jira / Requirement
       |
       v
Harness Agent
       |
       v
CodeGraph MCP
       |
       +--> Explore current implementation
       |
       +--> Trace full-stack flow
       |
       +--> Impact analysis
       |
       +--> Identify tests
       |
       v
Implementation Plan
       |
       v
Developer Agent
       |
       v
Code Change
       |
       v
Reviewer Agent
       |
       v
Verification / Tests
```

Đây là scope nên target thay vì cố xây lại toàn bộ CodeGraph.

---

# 28. Immediate Next Actions

Thứ tự bắt đầu implement:

```text
1. Init repository
2. Define GraphNode / GraphEdge
3. Implement SQLite schema
4. Implement FileScanner
5. Implement LanguageParser abstraction
6. Add Tree-sitter Java
7. Extract Java class/method/import
8. Persist nodes
9. Extract method calls
10. Build caller/callee query
11. Implement ContextBuilder
12. Implement code_explore MCP
13. Connect Claude Code
14. Test trên một Spring Boot project nhỏ
15. Add Spring REST semantics
16. Add Spring DI
17. Add repository/entity
18. Add impact analysis
19. Add Kafka/tests
20. Start React phase
```

Điểm checkpoint quan trọng nhất:

```text
Sau step 13:
MCP phải chạy được thực tế với Claude Code.
```

Không nên đợi hoàn thành Spring/React mới test integration MCP.
