# 变更记录（CHANGELOG）

格式：日期 + 类型 + 条目。**只追加，不改写历史。**当前进度以 [docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md) 为唯一来源，本文件不承载状态。

## 2026-10-19

### TASK-003 文档 CRUD API（实现 + 接口测试，待 Codex 验收）

### Added
- `backend/src/api.js`：Express 路由器工厂 `registerApi(app, { getDb, basePath })`，实现文档（增/查/列表/改/删）、分类（增/查/删）、标签（查/删）的 HTTP 接口；统一错误码→HTTP 状态码映射（`sendError`：invalid_input→400、not_found→404、conflict→409、constraint_failed→409、其余→500），409 冲突响应附带服务端当前快照 `current`；`detail` 仅非生产环境暴露。
- `backend/src/index.js`：在 `express.json({ limit: '2mb' })` 之后挂载 `registerApi`，业务接口上线（原健康检查与 `_dev/render-markdown` 保留）。
- `backend/src/api.test.js`：接口级自动化测试（node:test + 临时 http server + fetch），23 tests 全过，覆盖 F-KB-001/002/003 的 API 部分与分类/标签关联读写；含 409 冲突、`current` 快照、分页、非法 ID、空标题/超长正文 400、重名 409 等用例。
- `backend/package.json`：`test` 脚本改为 `node --test src/store.test.js src/api.test.js`。

### Verified
- `npm test` → 5 suites / 57 tests（store 34 + api 23），**全部 pass / 0 fail**。
- 真实后端联调（curl）：分类创建 201；文档创建（带 category_id/tags）201；读取 200 含 tags；列表返回 `{ total, items }`（含 category_name/tags）；旧版本更新 **409 + current 快照**；正确版本更新 200 version 递增；空标题 400；删除 204 后 GET 404。验证后已清空开发库测试数据。
- 开发库 `data/team-toolbox.sqlite3` 联调前后均为空库（测试数据已清理）。

### Notes
- 依用户 2026-10-19 "继续" 指令，在 TASK-002 自测通过基础上推进 TASK-003；**TASK-002 的 Codex 正式验收仍待补**，不宣称验收通过。
- 范围边界：标签小写合并（F-KB-005）、按标签 AND 过滤、分类重命名、搜索（F-KB-006）、首页最近更新（F-KB-008）属 TASK-006/007/008，本次未做；前端接入 UI 属 TASK-005，接口尚未被 UI 消费。
- 未提交 Git（与 TASK-002 修复一并待用户决定 push）；WorkBuddy 使用模型：MiniMax-M3；积分未提供，无法确认。

### TASK-002 修复：测试可运行 + 连接工厂支持 path 注入

### Fixed
- `backend/src/migrate.js`：`runMigrations` 改为 `async`（函数体内有 `await import('./db.js')`，原签名未声明 async，导致 SyntaxError: Unexpected reserved word）。
- `backend/src/errors.js`：`errorMap` 改为返回 `Error` 实例（携带 `code` / `detail` 属性）而不是普通对象；新增识别 `code === 'conflict'` / `context === 'conflict'`、`code.startsWith('SQLITE_CONSTRAINT_')`、`context === 'constraint_failed'`、`context === 'cannot_open'`、保留传入消息；不再让 `assert.throws(fn, /regex/)` 收到 `[object Object]`。
- `backend/src/db.js`：`createDatabase` 中 `mkdirSync` 失败映射为 `cannot_open`；`createTestingDatabase` 新增 `path` 注入参数，允许测试复用同一文件触发 busy lock；补回 `DB_PATH` 导出（`backend/src/index.js` 仍按文档预期使用）。
- `backend/src/store.js`：`createCategory` 中约束码识别改为 `SQLITE_CONSTRAINT` 或 `SQLITE_CONSTRAINT_*` 子码（better-sqlite3 抛 `SQLITE_CONSTRAINT_UNIQUE`），确保唯一约束违反被识别为重名。
- `backend/src/store.test.js`：把 `runMigrations` 调用统一改为 `await runMigrations`（配合 async 化）；`createTestingDatabase` 复用 `path` 参数，使"重开可读""独立连接忙锁""createDocument 持久化"用例可命中；`WAL` 用例改用文件 db（`journal_mode = WAL` 不适用于 `:memory:`）；`cannot_open` 用例改用 Windows 上明确不可写的盘符路径。

### Verified
- `npm run rebuild better-sqlite3` 成功（之前是为 Node 24 ABI 编译的 NODE_MODULE_VERSION 137，本机 Node 22 需 127）。
- `npm test` → 5 suites / 34 tests，**全部 pass / 0 fail / 0 cancelled**。
- `node src/index.js` 启动监听 127.0.0.1:3000；`GET /api/health` 返回 200，`db.ok=true`。
- `npm run migrate` 命令行入口仍可用。

### Notes
- 本次为修复 + 自测，**不代替 Codex 验收**。TASK-002 仍为"已实现（待 Codex 验收）"。
- 未启动：TASK-003 及之后任务；未动 frontend/*（属于阶段二 Codex 已验收范围，不在本修复 commit 中）。
- WorkBuddy 使用模型：MiniMax-M3；积分未提供，无法确认。

## 2026-10-16

### TASK-001 技术栈与脚手架（待 Codex 验收）

### Added
- 建立文档基线，共 9 个文件：README.md、AGENTS.md、docs/FUNCTIONAL_SPEC.md、docs/DEVELOPMENT_PLAN.md、docs/ARCHITECTURE.md、docs/USER_GUIDE.md、docs/PROJECT_STATUS.md、CHANGELOG.md、.gitignore。
- 功能规格：MVP 特性 12 项（F-KB-001~008、F-NAV-001~002、F-OPS-001~002）+ 延期特性 2 项（F-COL-001 实时共同编辑、F-SEC-001 账号与权限），含逐项验收标准与特性—任务覆盖矩阵。
- 开发计划：TASK-001~TASK-010 与延期 TASK-D01/D02，含交付物、依赖（无环）、阶段门槛与 MVP 完成判定。
- 架构基线：模块划分、数据实体、乐观版本与 409 冲突处理、备份恢复、内网访问边界、部署假设与待决策清单。
- 用户指南：明确当前未实现，仅描述预期操作流程，不含任何启动命令。
- 项目状态基线：唯一状态源，任务全部未开始，下一任务 TASK-001。
- .gitignore：排除依赖、构建产物、密钥、环境变量文件、本地数据与日志，保留 env.example。

### Notes
- 本基线只包含文档与 .gitignore：无产品代码、无测试，未执行任何构建、运行或部署。仓库为私有：https://github.com/GuiYe314/team-toolbox。

### Reviewed
- Codex 复核并明确标签 AND 语义、存储层冲突验证阶段、覆盖保存的条件写入、恢复前校验与失败回退；工具空状态仅展示用户所需信息。

### 阶段规划细化
- 将第一版划分为项目基础、界面与工具框架、知识库核心、内容组织与查找、数据保护、交付验收六阶段；账号权限和实时共同编辑列为两个后续阶段。
- 保留任务编号，明确实时协同依赖账号权限；同步状态与功能规格。
- 固化 WorkBuddy 模型与积分报告规则，未提供积分时不得推算。本次未调用 WorkBuddy。

### SQLite 数据库方案
- 根据用户指定确定 SQLite，更新功能规格、架构、开发任务与状态，新增数据库实施约定。
- 明确驱动与迁移选型、连接初始化、事务、关联约束、版本冲突、错误反馈和备份恢复的交付要求；忽略数据库辅助文件。
- 本次仅更新规划，数据库代码尚未实现，未调用 WorkBuddy。

### TASK-001 技术栈与脚手架（待 Codex 验收）
- 新增子项目 `backend/`（Node.js + Express 5 + better-sqlite3 + marked + sanitize-html）与 `frontend/`（Vue 3 + Vite 6）。
- 决策已写入 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) 第 9 节：Node.js v22 LTS、Express 5、better-sqlite3、手写迁移脚本、Vue 3 + Vite 6、Vue Router 4、marked + sanitize-html、SQL LIKE（参数化）、默认绑定 127.0.0.1。
- 新增 `backend/.env.example`、`frontend/.env.example`，子项目级 `.gitignore` 排除 .env、依赖、SQLite 与辅助文件；真实 `.env` 不入库。
- 实现 `backend/src/migrate.js`（扫描 `migrations/NNN_xxx.sql`，写入 `schema_migrations` 表）与 `backend/src/migrations/001_init.sql`（documents/categories/tags/document_tags + 索引 + 外键约定）。
- 实现 `backend/src/db.js`（PRAGMA WAL / foreign_keys = ON）、`backend/src/markdown.js`（marked + sanitize-html 白名单 + 强制 `rel="noopener noreferrer"`）、`backend/src/index.js`（`/api/health` + 临时 `POST /api/_dev/render-markdown`）。
- 实现 `frontend/src/App.vue`（阶段一占位页面：后端健康检查展示 + Markdown 渲染冒烟）。
- 实际验证：依赖安装（backend 117 包 / frontend 36 包）；`npm run migrate` 首次 applied=1、二次 applied=0 幂等通过；后端 `npm start` 监听 127.0.0.1:3000；`/api/health` 返回 200 含 db 信息；Markdown 渲染剥离 `<script>` 与 `javascript:` 协议外链；前端 `npm run dev` 启动 Vite、`/`、`/src/main.js`、`/src/App.vue` 均 200；`/api/*` 经 Vite proxy 命中后端返回正确 JSON；`npm run build` 生成 `dist/`。
- 文档：补充 [docs/USER_GUIDE.md](docs/USER_GUIDE.md) 第 4 节"本机启动（已验证）"；[docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md) 同步更新至"阶段一脚手架完成，待 Codex 验收"；[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) 第 9 节决策落定。
- 未启动：未执行 git commit/push、未做内网部署验证、未引入测试、未实现任何业务接口（CRUD/分类/标签/搜索/最近更新）；下一阶段待 Codex 验收通过后再启动。
- WorkBuddy 使用模型：MiniMax-M3（M2/M3 派生）；积分：本次响应未返回积分字段，按 [AGENTS.md](AGENTS.md) 第 11 条记录为"积分未提供，无法确认"。
