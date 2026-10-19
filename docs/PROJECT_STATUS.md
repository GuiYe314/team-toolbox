# 项目状态（PROJECT_STATUS）— 唯一状态源

- 更新日期：2026-10-19（TASK-002 修复：测试可运行，待 Codex 验收）
- 本文件是项目进度的**唯一来源**；README 等文档只链接引用、不复制进度。更新规则见 [AGENTS](../AGENTS.md)。
- 仓库：https://github.com/GuiYe314/team-toolbox（私有）

## 1. 当前基线

**TASK-002 自测修复**：在原"已实现（待 Codex 验收）"基础上修复了 `migrate.js` 缺 `async` / `errors.js` 返回非 Error / `db.js` 缺 path 注入与 cannot_open 映射 / 测试多处因 better-sqlite3 子码与共享文件路径问题导致的失败。`npm test` → 5 suites / 34 tests 全过；`/api/health` 200；`npm run migrate` 仍可用。**仍待 Codex 验收；不替 Code x 验收。**

## 2. 任务状态

当前开发阶段：阶段一（项目基础），**TASK-001 已完成，等待 Codex 验收**；未进入阶段二。功能阶段定义见 [开发计划](DEVELOPMENT_PLAN.md) 第 1 节；阶段一至六为第一版，阶段七、八为后续规划。

| 任务 | 状态 | 说明 |
|---|---|---|
| 文档基线（本批 9 个文件） | 完成 | 编写完成，自检见第 4 节 |
| TASK-001 技术栈决策与脚手架 | 完成（Codex 验收通过） | 沿用 2026-10-16 记录 |
| TASK-001 修复（Node.js 24 兼容） | 完成（Codex 验收通过） | 沿用 2026-10-16 记录 |
| TASK-002 服务端基础与持久化层 | **已实现 + 自测修复（待 Codex 验收）** | 本次 `npm test` 5 suites / 34 tests 全过；不宣称 Codex 验收通过 |
| TASK-003 文档 CRUD API | 未开始 | 依赖 TASK-002 验收通过 |
| TASK-004 前端框架与导航布局 | 未开始 | 依赖 TASK-001 验收通过 |
| TASK-005 Markdown 编辑与文档页面 | 未开始 | 依赖 TASK-003、TASK-004 |
| TASK-006 分类与标签 | 未开始 | 依赖 TASK-005 |
| TASK-007 搜索 | 未开始 | 依赖 TASK-005 |
| TASK-008 首页最近更新 | 未开始 | 依赖 TASK-005 |
| TASK-009 备份导出与恢复 | 未开始 | 依赖 TASK-002 |
| TASK-010 MVP 集成验收 | 未开始 | 依赖 TASK-005~TASK-009 |
| TASK-D01 实时共同编辑（延期） | 未开始 | 阶段八，依赖 TASK-D02 与协同方案确认 |
| TASK-D02 账号与权限（延期） | 未开始 | 阶段七，依赖 TASK-010 与账号方案确认 |

数据库方案已确定为 SQLite（2026-10-16，用户指定）；驱动 = better-sqlite3；迁移 = 手写 NNN_xxx.sql + `schema_migrations` 表；建表初版（001_init.sql）已实装，**业务读写层尚未实现**（TASK-002）。

## 3. 下一任务

**TASK-001 验收前的纪律**：在 Codex 复核通过前不要自行启动 TASK-002~TASK-010。

**TASK-001 通过验收后的下一任务**：TASK-002（服务端基础与持久化层）与 TASK-004（前端框架与导航布局）并行（TASK-001 是它们的唯一前置）。本文件将在 Codex 验收后更新。

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

未验证（明确范围之外）：
- 未执行任何单元/端到端测试（无测试代码，TASK-002 起引入）。
- 未做内网/远端部署验证（受控内网部署属于阶段六 TASK-010）。
- 未启用公网绑定（按 ARCHITECTURE 第 7 节边界禁止）。
- 备份与恢复尚未实现（TASK-009）。
- 自动备份、协同、账号权限、Markdown 编辑器、SQLite FTS5 待对应任务决策/实现。

## 5. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 其余技术栈与 SQLite 驱动未定 | 项目脚手架与数据库接入尚未落实 | TASK-001 完成剩余决策并记录理由（**已缓解**：决策已写入 ARCHITECTURE 第 9 节并实测通过） |
| 无认证部署于内网 | 误暴露公网导致数据公开可写 | F-OPS-001 边界声明；默认绑定 127.0.0.1；文档禁令；env.example 显式提醒 |
| 保存冲突体验差 | 并发编辑时误覆盖他人修改 | 乐观版本 + 409 + 人工两选项；实时协同已列延期规划 |
| 备份依赖手动 | 数据丢失风险 | TASK-009 恢复演练；自动化列入待决策 |
| Vue SFC 解析器限制 | `<script>` 块中含字面量 `</script>` 会让构建失败 | 已在脚手架文档与代码风格上规避；本任务已实测不含该字面量的完整构建 |
| 单人推进 | 知识与进度集中 | 决策与状态全部文档化，CHANGELOG 追加留痕 |

## 6. 更新纪律

每完成一个任务：更新第 2 节状态、第 3 节下一任务、第 4 节追加验证证据，并在 [CHANGELOG](../CHANGELOG.md) 追加条目；禁止把计划写成实现，禁止无证据的“已通过”。
