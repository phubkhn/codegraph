# Hướng dẫn sử dụng CodeGraph MCP (Tiếng Việt)

CodeGraph MCP là một **MCP server local-first**: nó quét source code của bạn
(Java/Spring Boot và React/TypeScript), dựng một **graph** (đồ thị) gồm
file/class/method/component và các quan hệ giữa chúng (gọi hàm, REST
endpoint, React hook/render, DI, JPA, Kafka...), lưu vào một file SQLite cục
bộ (`.codegraph/graph.db`), rồi expose ra 3 tool MCP để AI coding agent
(Claude Code) truy vấn thay vì phải `grep`/`glob` cả repo.

Tài liệu gốc (tiếng Anh) chi tiết hơn về setup và giới hạn nằm ở
[`claude-code-integration.md`](claude-code-integration.md). File này là bản
hướng dẫn tiếng Việt, tập trung vào: cách dùng thư viện, và cách **áp dụng nó
vào Skill / Agent / script khác**.

---

## 1. Thư viện làm được gì

- Quét code Java/Spring và React/TypeScript, dựng graph các node:
  `FILE`, `CLASS`, `INTERFACE`, `ENUM`, `FUNCTION`, `METHOD`, `VARIABLE`,
  `REST_ENDPOINT`, `REACT_COMPONENT`, `REACT_HOOK`, `ENTITY`, `KAFKA_TOPIC`,
  `TEST`, `ROUTE` (react-router), `CONFIG_PROPERTY` (key trong
  `application.yml`/`.properties`).
- Và các quan hệ (edge): `CONTAINS`, `IMPORTS`, `CALLS`, `EXTENDS`,
  `IMPLEMENTS`, `RENDERS`, `USES_HOOK`, `DEPENDS_ON` (DI / JPA / repository →
  entity / Spring config binding), `PRODUCES`/`CONSUMES` (Kafka), `TESTED_BY`,
  `MAPS_TO_ENDPOINT` (frontend gọi API → backend `REST_ENDPOINT`).
- Ngoài các quan hệ cơ bản, phía Java/Spring còn có:
  - **Lombok**: các method/field mà Lombok sinh ra lúc compile
    (`@Data`/`@Value`/`@Getter`/`@Setter`/`@Builder`/`@SuperBuilder`/
    `@ToString`/`@EqualsAndHashCode`/`@Slf4j` và các `@Log*` khác) được tổng
    hợp thành node thật trong graph — gọi `employee.getFirstName()` dù
    `getFirstName()` không có trong source vẫn resolve đúng, thay vì "biến
    mất" khỏi call graph. Member nào code đã viết tay thì Lombok không bao
    giờ ghi đè.
  - **Spring config binding**: field có `@Value("${key}")` hoặc class có
    `@ConfigurationProperties(prefix = "x")` được nối tới đúng key trong
    `application*.properties`/`.yml`/`.yaml` (hoặc `bootstrap*...`), kể cả
    khi cách viết key khác nhau (`pool-size` trong YAML và `poolSize` trong
    Java vẫn hội tụ về cùng 1 node).
- Cung cấp 3 MCP tool:
  - **`code_explore`** — tìm 1 symbol, trả về vị trí, source, ai gọi nó, nó
    gọi ai, endpoint/hook/component liên quan.
  - **`code_impact`** — "nếu sửa cái này thì ảnh hưởng những gì" (blast
    radius), gom nhóm theo endpoint/component/method/test.
  - **`code_path`** — tìm đường đi (call/render/hook) giữa 2 symbol, ví dụ từ
    1 trang React xuống tới REST endpoint / repository method ở backend.

Đây **không phải một npm package đã publish** — bạn chạy nó trực tiếp từ
source (`dist/cli/index.js`) hoặc `npm link` để có binary `codegraph` trên
PATH.

---

## 2. Cài đặt & build

```bash
cd codegraph-mcp
npm install
npm run build
```

Lệnh này build ra `dist/cli/index.js`. Có 2 cách dùng:

**Cách 1 — gọi trực tiếp bằng đường dẫn tuyệt đối** (không cần cài global,
dùng được từ mọi máy có checkout repo này):

```bash
node /path/to/codegraph-mcp/dist/cli/index.js <command>
```

**Cách 2 — `npm link` để có binary `codegraph` toàn cục:**

```bash
cd codegraph-mcp
npm run build
npm link
```

Sau đó dùng `codegraph <command>` ở bất kỳ project nào.

---

## 3. Dùng CLI trong project đích

Trong project Java/Spring hoặc React/TypeScript mà bạn muốn Claude Code
"hiểu" cấu trúc code:

```bash
cd /path/to/your-project
codegraph init      # sinh file cấu hình .codegraph.yml
codegraph index      # quét + dựng graph vào .codegraph/graph.db
codegraph status     # xem số file/node/edge, lần index gần nhất
```

Re-index chỉ xử lý incremental (theo hash file) nên chạy lại rất nhanh. Nhớ
thêm `.codegraph/` vào `.gitignore` — graph là artifact cục bộ, không commit.

Các lệnh CLI khác:

| Lệnh | Mô tả |
|---|---|
| `codegraph scan` | Đếm số file discover/support/ignore, chưa parse |
| `codegraph index [--force]` | Parse + dựng lại graph (mặc định incremental) |
| `codegraph status` | Thống kê graph hiện tại |
| `codegraph search <symbol>` | Tìm fuzzy theo tên/qualified name |
| `codegraph explore <symbol> [--no-source]` | Xem context 1 symbol |
| `codegraph impact <symbol> [--depth n]` | Blast-radius của 1 symbol |
| `codegraph path <from> <to> [--depth n]` | Đường đi giữa 2 symbol |
| `codegraph mcp` | Chạy MCP server qua stdio |

### File cấu hình `.codegraph.yml`

```yaml
project:
  name: payroll

index:
  roots: [backend, frontend]   # thư mục cần quét, tương đối gốc project
  ignore: []

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
  deny: []   # thêm glob pattern không bao giờ được index
```

`.gitignore` và `.codegraphignore` ở gốc project được tự động tôn trọng,
cộng thêm danh sách ignore/deny mặc định (`node_modules`, `target`, `build`,
`dist`, `.git`, `.env*`, `*.pem`, `*.key`...).

---

## 4. Xem trực quan graph để kiểm tra

Đây là câu hỏi thường gặp khi mới index xong: "graph có đúng không, làm sao
xem cho trực quan?". Có 3 cách, từ nhanh tới đầy đủ nhất.

### 4.1. Kiểm tra nhanh bằng CLI có sẵn (không cần thêm gì)

Không cần công cụ ngoài, dùng ngay các lệnh đã có:

```bash
codegraph status                       # tổng số file/node/edge
codegraph search "LoanService"         # graph có thấy symbol này không
codegraph explore "LoanService.disburse"   # xem source + callers/callees
codegraph impact "LoanService.disburse"    # xem blast-radius dạng cây/text
codegraph path "LoanPage" "LoanController.create"  # xem đường đi giữa 2 symbol
```

Cách này đủ dùng cho phần lớn việc "check" hằng ngày vì output đã có cấu
trúc rõ ràng (source, callers, callees, endpoint...).

### 4.2. Xem thẳng dữ liệu trong SQLite (khi cần đối chiếu số liệu chi tiết)

Graph chỉ là 1 file SQLite với 3 bảng `files`, `nodes`, `edges`
(`nodes.metadata`/`edges.metadata` là JSON). Dùng `sqlite3` CLI có sẵn trên
máy để query trực tiếp:

```bash
sqlite3 /path/to/your-project/.codegraph/graph.db \
  "SELECT type, count(*) FROM nodes GROUP BY type;"

sqlite3 /path/to/your-project/.codegraph/graph.db \
  "SELECT n1.name, e.type, n2.name
   FROM edges e
   JOIN nodes n1 ON n1.id = e.source
   JOIN nodes n2 ON n2.id = e.target
   WHERE n1.name = 'LoanService' OR n2.name = 'LoanService';"
```

Hoặc dùng GUI như [DB Browser for SQLite](https://sqlitebrowser.org/) để mở
`.codegraph/graph.db` và duyệt bảng bằng chuột.

### 4.3. Xem dạng đồ thị (hình vẽ node-edge) trong trình duyệt

Repo có sẵn script `scripts/export-graph-html.mjs` xuất toàn bộ graph ra 1
file HTML độc lập (dùng [vis-network](https://visjs.github.io/vis-network/)
qua CDN), tô màu theo loại node, có ô lọc theo tên:

```bash
cd codegraph-mcp
node scripts/export-graph-html.mjs /path/to/your-project codegraph.html
open codegraph.html   # macOS; Linux dùng xdg-open, Windows dùng start
```

Mở file này lên sẽ thấy các node (file/class/method/component...) tô màu
theo type, các cạnh có nhãn quan hệ (`CALLS`, `CONTAINS`, `IMPORTS`,
`USES_HOOK`...), kéo/zoom được, gõ vào ô filter để chỉ hiện node có tên
khớp. Cần internet để tải vis-network từ CDN lúc mở file (dữ liệu graph thì
đã nhúng sẵn trong file, không gọi network để lấy data).

Dùng cách này khi muốn nhìn tổng quan cấu trúc, phát hiện node bị cô lập
(không có cạnh nào — có thể là dấu hiệu parser bỏ sót), hoặc kiểm tra trực
quan xem 1 luồng full-stack có nối liền từ React xuống Spring hay không
trước khi tin vào `code_path`.

---

## 5. Áp dụng vào Claude Code như một MCP server

Đây là cách dùng "chuẩn" nhất — đăng ký làm MCP server để Claude Code tự gọi
3 tool ở trên khi cần.

### 5.1. Tạo `.mcp.json` ở gốc project đích

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

`.mcp.json` nên được commit vào repo để cả team dùng chung. Dùng đường dẫn
tuyệt đối tới `codegraph-mcp` vì package chưa publish lên registry. Sau khi
thêm, restart Claude Code hoặc chạy `/mcp` để kết nối lại.

### 5.2. Tự động re-index bằng hook `SessionStart`

Thêm vào `.claude/settings.json` (commit vào repo) để mỗi phiên Claude Code
mới tự re-index trước khi làm gì khác:

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

Vì index là incremental nên hook này luôn nhanh sau lần chạy đầu. Nếu repo
lớn, chạy `codegraph index` thủ công 1 lần trước (mục 3) để hook chỉ còn việc
nhỏ.

---

## 6. Áp dụng vào Skill (Claude Code Skill)

Một **Skill** trong Claude Code là 1 file Markdown (thường ở
`.claude/skills/<ten-skill>/SKILL.md` trong project, hoặc
`~/.claude/skills/` cho skill dùng chung mọi project) chứa hướng dẫn mà
Claude nạp vào khi bạn gọi `/ten-skill`. Skill **không tự có quyền truy cập
tool mới** — nó chỉ hướng dẫn Claude *cách dùng* các tool đã có sẵn (kể cả
MCP tool đã đăng ký ở mục 5). Vì vậy điều kiện tiên quyết là project đích đã
có `.mcp.json` trỏ tới `codegraph mcp` như trên.

Ví dụ tạo skill `.claude/skills/code-graph/SKILL.md`:

```markdown
---
name: code-graph
description: Dùng CodeGraph MCP (code_explore/code_impact/code_path) để tra cứu call graph, REST endpoint, blast-radius thay vì grep. Dùng khi cần hiểu 1 symbol, đánh giá impact trước khi sửa, hoặc lần theo luồng full-stack.
---

Khi được gọi, thực hiện theo thứ tự:

1. Nếu người dùng chỉ 1 symbol/class/method cụ thể → gọi tool `code_explore`
   với `query` là tên symbol đó để lấy source, callers, callees, endpoint
   liên quan.
2. Nếu người dùng hỏi "sửa cái X có ảnh hưởng gì không" → gọi `code_impact`
   trên X, tóm tắt các endpoint/component/method/test bị ảnh hưởng.
3. Nếu người dùng hỏi về 1 luồng full-stack (ví dụ "tạo khoản vay hoạt động
   thế nào") → gọi `code_path` từ điểm bắt đầu (component/route) tới điểm
   kết thúc (controller/repository) nghi ngờ liên quan.
4. Nếu tool trả về "no symbol found", graph có thể đang cũ — chạy
   `node /path/to/codegraph-mcp/dist/cli/index.js index` rồi thử lại trước
   khi rơi về grep thường.
5. Luôn coi kết quả graph là **gợi ý mạnh, không phải chân lý tuyệt đối**
   (xem mục "Giới hạn" bên dưới) — xác nhận lại bằng source code thật trong
   `code_explore` trước khi kết luận.
```

Gọi bằng `/code-graph` trong 1 phiên Claude Code ở project đích, hoặc để
Claude tự nhận diện khi mô tả trong `description` khớp với yêu cầu người
dùng.

---

## 7. Áp dụng vào Agent (subagent)

**Subagent** là 1 agent con định nghĩa ở `.claude/agents/<ten-agent>.md`
(project) hoặc `~/.claude/agents/` (toàn cục), có `system prompt` và danh
sách `tools` riêng, được gọi qua Agent tool khi task khớp mô tả.

Vì MCP tool của `codegraph` chạy qua `.mcp.json` (cấu hình ở cấp session,
không cấp agent), subagent kế thừa các MCP tool đã kết nối của phiên chính —
bạn chỉ cần liệt kê chúng trong front-matter `tools` của agent (hoặc để trống
để agent có tất cả tool sẵn có).

Ví dụ `.claude/agents/impact-analyst.md`:

```markdown
---
name: impact-analyst
description: Dùng khi cần đánh giá blast-radius của 1 thay đổi (method/service/repository/REST endpoint dùng chung) trước khi sửa code, dựa trên CodeGraph MCP.
tools: mcp__codegraph__code_explore, mcp__codegraph__code_impact, mcp__codegraph__code_path, Read, Grep
---

Bạn là chuyên gia phân tích blast-radius cho codebase Java/Spring +
React/TypeScript này.

Quy trình:
1. Gọi `code_explore` trên symbol được giao để hiểu vị trí, chữ ký, và
   callers/callees hiện tại.
2. Gọi `code_impact` trên cùng symbol để liệt kê toàn bộ endpoint, component,
   method, test bị ảnh hưởng — nhóm theo loại.
3. Nếu cần lần theo luồng cụ thể (ví dụ từ React component xuống Spring
   controller), gọi `code_path`.
4. Nếu graph báo "no symbol found", ghi rõ trong báo cáo rằng graph có thể
   đang cũ (cần `codegraph index --force`) thay vì suy luận từ tên gọi.
5. Trả về báo cáo ngắn gọn: symbol đã đổi, danh sách ảnh hưởng theo nhóm
   (BE/FE/test), và mức độ tin cậy (dựa trên "Giới hạn" bên dưới — ví dụ DI
   qua setter, Kafka topic động, hay Redux/Context phía React đều KHÔNG được
   model hoá; react-router thì ĐÃ có).
```

Tên tool MCP theo format `mcp__<server-name-trong-mcp.json>__<tool-name>`,
tức nếu bạn đặt server tên `codegraph` như ví dụ ở mục 5.1 thì 3 tool sẽ là
`mcp__codegraph__code_explore`, `mcp__codegraph__code_impact`,
`mcp__codegraph__code_path`.

---

## 8. Áp dụng vào script khác (ngoài Claude Code)

`codegraph-mcp` chưa publish npm package, nên dùng từ script khác theo 2
cách:

### 8.1. Gọi CLI qua subprocess (đơn giản, khuyến nghị)

```bash
# Node.js
node -e "
const { execFileSync } = require('child_process');
const out = execFileSync('node', [
  '/path/to/codegraph-mcp/dist/cli/index.js', 'explore', 'LoanService.disburse'
], { cwd: '/path/to/your-project', encoding: 'utf8' });
console.log(out);
"
```

```bash
# hoặc trực tiếp trong bash script
node /path/to/codegraph-mcp/dist/cli/index.js impact LoanService.disburse --depth 3
```

Cách này phù hợp cho CI script, pre-commit hook, hoặc agent framework khác
(không phải Claude Code) muốn gọi ra ngoài như 1 CLI tool thông thường.

### 8.2. Gọi bất kỳ MCP client nào khác

Vì `codegraph mcp` chỉ là 1 MCP server chuẩn chạy qua stdio, **bất kỳ MCP
client nào** (không riêng Claude Code — ví dụ 1 script tự viết dùng
`@modelcontextprotocol/sdk` client) đều có thể spawn:

```bash
node /path/to/codegraph-mcp/dist/cli/index.js mcp
```

và nói chuyện qua giao thức MCP chuẩn (`tools/list`, `tools/call`).

### 8.3. Import trực tiếp module core (nâng cao, dùng nội bộ)

Nếu script Node.js của bạn nằm trong monorepo và muốn tránh chi phí spawn
process, có thể import thẳng `AppContext` (không phải API public đã ổn định,
có thể đổi giữa các version):

```ts
import { createAppContext } from "codegraph-mcp/dist/core/app-context.js";

const ctx = createAppContext("/path/to/your-project");
const results = await ctx.queryService.search("LoanService");
ctx.close();
```

Cách này **rủi ro hơn** vì không phải API đã công bố ổn định — chỉ dùng khi
bạn kiểm soát cả 2 phía (script và version của `codegraph-mcp`).

---

## 9. Quy trình SDLC gợi ý (khi dùng qua Claude Code)

```
Yêu cầu / ticket
   |
   v
code_explore <symbol nêu trong ticket>      # xem implementation hiện tại
   |
   v
code_impact <symbol>                         # blast-radius: BE/FE/endpoint
   |
   v
Viết implementation plan trước khi sửa
   |
   v
Thực hiện thay đổi
   |
   v
code_impact <các symbol đã đổi>              # xác nhận không bỏ sót gì, kể cả test
   |
   v
Chạy các test mà code_impact đã gắn cờ — cả 2 phía đều có TESTED_BY:
Java/Spring qua class `@Test`/`@SpringBootTest`/... (naming convention
`XTest`/`XIT` → `X`), React qua file `X.test.tsx` → `X` (test theo file vì
JS test là block `describe`/`it`, không phải class)
```

---

## 10. Giới hạn cần biết (đừng tin graph 100%)

- **Call resolution là best-effort, không phải compiler.** Java: theo type
  constructor/field, cùng package, rồi fallback "tên duy nhất trong project"
  — nhưng fallback này **chỉ áp dụng cho lời gọi không có receiver rõ ràng**.
  Một lời gọi có receiver (`obj.method()`) mà receiver đó không resolve được
  về class nào trong project (thư viện ngoài, ví dụ `Objects.equals(...)`,
  `someBean.libMethod()`) thì bị để **unresolved**, không rơi xuống fallback
  đoán theo tên nữa — trước đây phần này có bug khiến nó đoán bừa sang 1
  method trùng tên không liên quan, có trường hợp thật (phát hiện khi
  dogfooding trên repo Spring thật) là **method tự trỏ vào chính nó**. Đã
  fix. TypeScript cũng áp dụng cùng logic: cùng file → relative import →
  fallback tên duy nhất, với cùng guard chặn receiver-ngoài-project. Lời gọi
  mơ hồ **không có receiver** (nhiều method/function trùng tên) vẫn **không**
  được đoán mà bị bỏ qua như cũ — `code_impact`/`code_path` "miss" có thể là
  do mơ hồ hoặc do gọi vào thư viện ngoài, không phải "không có quan hệ".
- **Java/Spring — đã model:** constructor injection, `@Autowired` field
  injection, JPA entity graph, repository → entity linking, Kafka
  producer/consumer (topic là literal string), test mapping theo naming
  convention (`XTest`/`XIT` → `X`), **Lombok** (`@Data`/`@Value`/`@Getter`/
  `@Setter`/`@Builder`/`@SuperBuilder`/`@ToString`/`@EqualsAndHashCode`/
  `@Slf4j` và các `@Log*` khác — method/field Lombok sinh ra được tổng hợp
  thành node thật, member nào code viết tay rồi thì không bao giờ bị ghi đè),
  và **Spring config binding** (`@Value("${key}")` /
  `@ConfigurationProperties(prefix=...)` nối tới đúng key trong
  `application*`/`bootstrap*` `.properties`/`.yml`/`.yaml`, kể cả khi cách
  viết key khác nhau giữa YAML kebab-case và Java camelCase).
- **Java/Spring — chưa model:** setter injection, `@Qualifier`, Kafka topic
  động (biểu thức không phải literal), Feign/WebClient/RestTemplate/Spring
  Batch/Scheduler/Redis, Spring application event
  (`publishEvent`/`@EventListener`).
- **React — đã model (không chỉ function component):** component/hook
  tagging, render tree (`RENDERS`, có `metadata.props` là tên prop) cho cả
  function component **và** `class X extends React.Component`/
  `PureComponent` — cạnh render của class component được ghi ở cả trên chính
  class (để tra theo tên vẫn ra) lẫn trên method `render` của nó (để
  `code_path` đi tiếp được qua nhiều lớp class component lồng nhau); JSX
  viết trong file `.js`/`.jsx` thường (không chỉ `.tsx`) giờ parse đúng —
  trước đây JSX trong file `.js` không được nhận diện, mất hết
  RENDERS/USES_HOOK ở những file đó. Ngoài ra có hook usage (`USES_HOOK`),
  function call thường (`CALLS`), react-router (`<Route>` JSX lẫn
  `createBrowserRouter([{path,element}])`) mapping vào node `ROUTE`, frontend
  API-client detection (`fetch`/`axios`/wrapper tuỳ ý) **join thẳng vào
  cùng 1 node** với `REST_ENDPOINT` bên Spring khi cả 2 phía đều được index,
  và test mapping theo tên file (`X.test.tsx` → `X`).
- **React — chưa model:** Redux/Context/state-management flow
  (`useSelector`/`dispatch`), prop-passing xuyên nhiều tầng component,
  `createBrowserRouter` nhận biến `routes` khai báo riêng thay vì mảng inline
  thì không trace được, việc join FE↔BE vẫn cần path khớp chính xác sau khi
  chuẩn hoá (`${id}`/`:id` chuẩn hoá về cùng dạng `{param}`, nhưng HTTP
  method không phải literal hoặc query string phía sau path thì không khớp).
- **Object-literal export không được parse** (ví dụ `export const api = {
  get: ... }`) — chỉ index `function`/`class`/`const () => {}` top-level và
  method trong class.
- **Staleness khi rename/xoá:** incremental index chỉ re-resolve file vừa
  parse lại; caller ở file *không đổi* trỏ tới symbol *đã đổi tên* ở file
  khác có thể bị cũ tới khi chạy `codegraph index --force`.
- **`maxDepth` mặc định (4) có thể quá nông cho luồng full-stack.** Route →
  page → hook → API client → endpoint → controller → service → repository dễ
  dàng vượt 6 hop. `code_path`/`code_impact` nhận tham số `depth` — tăng lên
  khi query full-stack thay vì mặc định "no path" nghĩa là "không có quan
  hệ".

Không cái nào ở trên phủ nhận giá trị cốt lõi (call graph, REST endpoint,
DI/JPA/Kafka phía Java, component/hook phía React, blast-radius) — chỉ là
graph nên được coi là **gợi ý mạnh**, không phải sự thật tuyệt đối. Luôn xác
nhận lại bằng source code thật (`code_explore`) trước khi kết luận.

---

## 11. Xử lý sự cố (Troubleshooting)

```bash
# Xem kích thước / độ mới của graph
codegraph status

# Rebuild toàn bộ (khắc phục staleness sau refactor/rename lớn)
codegraph index --force

# Kiểm tra 1 symbol có resolve được không
codegraph search "TenSymbolCanTim"
```

Nếu `code_explore`/`code_impact`/`code_path` trả về "no symbol found", gần
như luôn là do query chưa đủ gần với qualified name mà `search` trả ra (ví
dụ cần `com.example.loan.LoanService.disburse` thay vì chỉ `disburse` nếu có
nhiều method trùng tên `disburse`).
