# 项目状态（PROJECT_STATUS）— 唯一状态源

- 更新日期：2026-10-19（TASK-003 文档 CRUD API 实现 + 接口测试通过，待 Codex 验收）
- 本文件是项目进度的**唯一来源**；README 等文档只链接引用、不复制进度。更新规则见 [AGENTS](../AGENTS.md)。
- 仓库：https://github.com/GuiYe314/team-toolbox（私有）

## 1. 当前基线

**TASK-002 自测修复**：在原"已实现（待 Codex 验收）"基础上修复了 `migrate.js` 缺 `async` / `errors.js` 返回非 Error / `db.js` 缺 path 注入与 cannot_open 映射 / 测试多处因 better-sqlite3 子码与共享文件路径问题导致的失败。`npm test`（store）5 suites / 34 tests 全过；`/api/health` 200；`npm run migrate` 仍可用。**仍待 Codex 验收；不替 Codex 验收。**

**TASK-003 文档 CRUD API（本次实现）**：在 TASK-002 的同步存储层（`store.js`）之上新增 `api.js`（Express 路由 + 统一错误码→HTTP 状态码映射）、在 `index.js` 挂载，并新增 `api.test.js`（接口级自动化测试，23 tests 全过）。覆盖 F-KB-001/002/003 的 API 部分与分类/标签关联读写。接口级验证见第 4 节。**已实现 + 自测通过，待 Codex 验收；TASK-002 的 Codex 验收仍待补。**

## 2. 任务状态

当前开发阶段：阶段三（知识库核心闭环）进行中（TASK-002、TASK-003 已实现待 Codex 验收；TASK-005 未开始）。功能阶段定义见 [开发计划](DEVELOPMENT_PLAN.md) 第 1 节；阶段一至六为第一版，阶段七、八为后续规划。

| 任务 | 状态 | 说明 |
|---|---|---|
| 文档基线（本批 9 个文件） | 完成 | 编写完成，自检见第 4 节 |
| TASK-001 技术栈决策与脚手架 | 完成（Codex 验收通过） | 沿用 2026-10-16 记录 |
| TASK-001 修复（Node.js 24 兼容） | 完成（Codex 验收通过） | 沿用 2026-10-16 记录 |
| TASK-002 服务端基础与持久化层 | **已实现 + 自测修复（待 Codex 验收）** | 本次 `npm test`（store）5 suites / 34 tests 全过；不宣称 Codex 验收通过 |
| TASK-003 文档 CRUD API | **已实现 + 接口测试通过（待 Codex 验收）** | 本次新增 `api.js`/`api.test.js`；`npm test`（api）23 tests 全过；覆盖 F-KB-001/002/003 API 部分 + 分类/标签关联读写 |
| TASK-004 前端框架与导航布局 | 已实现（工作区代码，待 Codex 验收；未由本会话验证） | 前一会话 Codex 在工作区落地前端代码但未提交；本会话未改动/验证 |
| TASK-005 Markdown 编辑与文档页面 | 未开始 | 依赖 TASK-003、TASK-004 |
| TASK-006 分类与标签 | 未开始 | 依赖 TASK-005（含标签小写合并等 F-KB-005 细则） |
| TASK-007 搜索 | 未开始 | 依赖 TASK-005 |
| TASK-008 首页最近更新 | 未开始 | 依赖 TASK-005 |
| TASK-009 备份导出与恢复 | 未开始 | 依赖 TASK-002 |
| TASK-010 MVP 集成验收 | 未开始 | 依赖 TASK-005~TASK-009 |
| TASK-D01 实时共同编辑（延期） | 未开始 | 阶段八，依赖 TASK-D02 与协同方案确认 |
| TASK-D02 账号与权限（延期） | 未开始 | 阶段七，依赖 TASK-010 与账号方案确认 |

数据库方案已确定为 SQLite（2026-10-16，用户指定）；驱动 = better-sqlite3；迁移 = 手写 NNN_xxx.sql + `schema_migrations` 表；建表初版（001_init.sql）已实装；业务读写层（TASK-002 存储层 + TASK-003 HTTP 接口）已实现并自测通过。

## 3. 下一任务

**纪律说明（更新于 2026-10-19）**：TASK-002 / TASK-003 均已实现并自测通过，但**仍待 Codex 正式验收**，不宣称验收通过。依用户 2026-10-19 "继续" 指令，在 TASK-002 自测通过的基础上推进了 TASK-003；后续 TASK-005~TASK-010 应在 TASK-002、TASK-003、TASK-004 均通过 Codex 验收后再启动。

**下一任务**：TASK-005（Markdown 编辑与文档页面），依赖 TASK-003（本次完成）、TASK-004（工作区已实现，待验收）。正式开工前建议先补齐 TASK-002/003/004 的 Codex 验收。

## 4. 验证证据（截至 2026-10-16）

**文档基线自检（沿用 2026-10-16 基线）**：9 个文件存在，链接有效，编号唯一，依赖无环，双向覆盖一致；详见 [CHANGELOG.md](../CHANGELOG.md) 的 2026-10-16 条目。

**TASK-001 实际验证摘要**：

- 仓库目录新增 `backend/`、`frontend/`、`data/`（数据库文件；被 `.gitignore` 排除）；修改 `docs/ARCHITECTURE.md`、`docs/USER_GUIDE.md`、本文件、`CHANGELOG.md`；其他文档与 `.gitignore` 未改。
- `backend/`：`backend/package.json`、`backend/src/index.js`、`backend/src/db.js`、`backend/src/migrate.js`、`backend/src/markdown.js`、`backend/src/migrations/001_init.sql`、`backend/.env.example`、`backend/.gitignore`。
- `frontend/`：`frontend/package.json`、`frontend/vite.config.js`、`frontend/index.html`、`frontend/src/main.js`、`frontend/src/App.vue`、`frontend/.env.example`、`frontend/.gitignore`。
- **依赖安装**：`npm install`（后端）输出 `added 117 packages in 26s`；`npm install`（前端）输出 `added 36 packages in 1m`。
- **迁移**：`npm run migrate` 首次输出 `[migrate] applied 001_init.sql`（生成 `data/team-toolbox.sqlite3`，约 53248 字节）；二次输出 `applied_in_this_run=0`，幂等通过。
- **后端启动**：`HOST=127.0.0.1 PORT=3000 npm start` 控制台输出 `[server] listening on http://127.0.0.1:3000` 与 `[server] node: v22.22.2`；`curl -sS http://127.0.0.1:3000/api/health` 返回 200 + `{"status":"ok",...,"db":{"ok":true,"size_bytes":53248}}`。
- **Markdown 渲染冒烟**：`POST /api/_dev/render-markdown` 输入含 `<script>alert(1)</script>` 与 `javascript:` 协议外链，输出 `<h2>`/`<p>`/`<ul>`/`<pre>`/`<code>`，`<script>` 被剥离、`javascript:` href 被剥离、外链 `<a>` 自动加 `rel="noopener noreferrer"`，安全渲染通过。
- **前端启动**：`npm run dev` 输出 `VITE v6.4.4 ready in 1631 ms`；`curl http://127.0.0.1:5173/` 返回 200，HTML 含 `<div id="app">`；`/src/main.js`、`/src/App.vue` 模块返回 200。
- **前后端代理联通**：`curl http://127.0.0.1:5173/api/health` 通过 Vite proxy 命中后端，返回与 3000 直接访问一致的响应。
- **`npm run build`（前端）**：输出 `dist/index.html`、`dist/assets/index-*.css`、`dist/assets/index-*.js`，未报错。

**TASK-003 实际验证摘要（2026-10-19，Windows + Node.js v22.22.2）**：

- **接口级自动化测试**：`npm test`（含 `src/api.test.js`）共 5 suites / 57 tests 全过（store 34 + api 23）。覆盖：文档新建/读取/列表/更新/删除、空标题与超长正文 400、非法 ID 400、乐观版本冲突 409（含 `current` 快照）、分类增删查、重名 409、标签查删、分页参数。
- **真实后端联调**（启动 `node src/index.js`，curl 验证）：
  - `POST /api/categories` → 201 `{"id":1,"name":"前端",...}`
  - `POST /api/documents`（含 `category_id`、`tags`）→ 201 `version:1`
  - `GET /api/documents/:id` → 200，返回文档 + `tags` 数组
  - `GET /api/documents?limit=5` → 200 `{"total":1,"items":[...]}`（含 `category_name`、`tags`）
  - `PUT /api/documents/:id` 旧版本 → **409** `{"error":"conflict","current":{...version:1...}}`（F-KB-002 冲突语义通过）
  - `PUT /api/documents/:id` 正确版本 → 200 `{"version":2,...}`
  - `POST /api/documents` 空标题 → 400 `invalid_input`
  - `DELETE /api/documents/:id` → 204，再次 GET → 404
  - 验证后已清理开发库中的测试数据（分类/标签/文档均清空），`data/team-toolbox.sqlite3` 恢复为空库。
- **错误映射**：`invalid_input→400` / `not_found→404` / `conflict→409` / `constraint_failed→409`（重名）/ 其他→500，响应体统一为 `{ error, message, current?, detail? }`，`detail` 仅非生产环境暴露。

TASK-003 范围边界（明确不在本次）：
- 标签名"英文小写合并"（F-KB-005 细则）与按标签 AND 过滤、分类重命名、搜索（F-KB-006）、首页最近更新（F-KB-008）均属后续任务（TASK-006/007/008），本次仅提供分类/标签关联的读写支撑。
- 前端尚未消费这些接口（TASK-005），接口未被 UI 调用验证。

未验证（明确范围之外）：
- 未做内网/远端部署验证（受控内网部署属于阶段六 TASK-010）。
- 未启用公网绑定（按 ARCHITECTURE 第 7 节边界禁止）。
- 备份与恢复尚未实现（TASK-009）。
- 自动备份、协同、账号权限、Markdown 编辑器、SQLite FTS5 待对应任务决策/实现。
- TASK-002/003/004 的 **Codex 正式验收** 仍待补（本会话只做自测）。

## 5. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 其余技术栈与 SQLite 驱动未定 | 项目脚手架与数据库接入尚未落实 | TASK-001 完成剩余决策并记录理由（**已缓解**：决策已写入 ARCHITECTURE 第 9 节并实测通过） |
| 无认证部署于内网 | 误暴露公网导致数据公开可写 | F-OPS-001 边界声明；默认绑定 127.0.0.1；文档禁令；env.example 显式提醒 |
| 保存冲突体验差 | 并发编辑时误覆盖他人修改 | 乐观版本 + 409 + 人工两选项；实时协同已列延期规划 |
| 备份依赖手动 | 数据丢失风险 | TASK-009 恢复演练；自动化列入待决策 |
| Vue SFC 解析器限制 | `<script>` 块中含字面量 `</script>` 会让构建失败 | 已在脚手架文档与代码风格上规避；本任务已实测不含该字面量的完整构建 |
| API 尚未被前端消费 | TASK-003 接口未接入 UI，无法验证端到端真实路径 | 待 TASK-005 接入；接口层已用自动化测试 + curl 联调覆盖 |
| 单人推进 | 知识与进度集中 | 决策与状态全部文档化，CHANGELOG 追加留痕 |

## 6. 更新纪律

每完成一个任务：更新第 2 节状态、第 3 节下一任务、第 4 节追加验证证据，并在 [CHANGELOG](../CHANGELOG.md) 追加条目；禁止把计划写成实现，禁止无证据的“已通过”。
