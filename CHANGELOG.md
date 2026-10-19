# 变更记录（CHANGELOG）

格式：日期 + 类型 + 条目。**只追加，不改写历史。**当前进度以 [docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md) 为唯一来源，本文件不承载状态。

## 2026-10-19

### TASK-007 搜索（实现 + 单测/浏览器验证，待 Codex 验收）

### Added
- `backend/src/store.js`：新增 `searchDocuments`（关键词参数化 `LIKE` 匹配标题或正文，不区分大小写；`%`/`_`/`\` 通配符转义为字面量防注入；空关键词返回空；结果按 `updated_at` 倒序、分页；附带 `snippet` 摘要片段）。
- `backend/src/api.js`：新增 `GET /search?q=&limit=&offset=`（空关键词不发起查询返回空结果）；文件头注释覆盖 F-KB-006。
- `frontend/src/api/client.js`：新增 `api.search(q, {limit, offset})`。
- `frontend/src/views/KnowledgeBase.vue`：用真实搜索框替换「搜索即将在 TASK-007 开放」占位；输入防抖 300ms 切换搜索模式，结果渲染标题/摘要/分类/标签；无结果空状态；分页「加载更多」；「清除」回列表；点击分类/标签 chip 退出搜索。

### Changed
- `docs/ARCHITECTURE.md` 第 9 节：搜索实现由"待决策"明确为参数化 `LIKE` 子串匹配方案（未引入 FTS5）。

### Verified
- `npm test`（backend）→ 5 suites / **93 tests 全过 / 0 fail**（store 34 + api 23 + 页面树 12 + 分类标签 +11 + 搜索 +8）。
- `npm run build`（frontend）→ 构建通过（KnowledgeBase 分块 10.93kB）。
- 真实后端联调（curl，dev 库演示数据）：`?q=规范`→3 篇；`?q=Unity`→1 篇；`?q=50%` 特殊字符→0 不报错；空关键词→`{total:0,items:[]}`。
- 真实 Edge 浏览器（puppeteer-core，脚本置于 `.workbuddy/ui-verify` 不入库）8 项交互断言全过（搜索框、搜索「规范」→3 条且计数文案正确、清空回列表、无结果空状态、特殊字符「50%」不崩溃、清除按钮）。
- 中文搜索采用子串 `LIKE`，契合中文无词边界；通配符转义防注入。

### Notes
- 覆盖 F-KB-006（搜索）。搜索与分类/标签过滤相互独立，未做组合筛选。
- 仍待 Codex 验收；浏览器交互式视觉验收需在浏览器手工确认。
- 未提交 Git（与既有改动一并待用户决定 push）；WorkBuddy 使用模型：MiniMax-M3；积分未提供，无法确认。

### TASK-006 分类与标签（实现 + 单测/浏览器验证，待 Codex 验收）

### Added
- `backend/src/store.js`：`createCategory` 新增分类数量上限 50（达上限返回 `invalid_input`）；新增 `updateCategory`（空名→`invalid_input`、重名→`constraint_failed`、不存在→`not_found`，成功 `UPDATE categories SET name=?`）；`validateTags` 改为英文小写合并（`toLowerCase()`）+ 去首尾空白 + 去重（`[...new Set]`），单文档≤10；`listDocuments` 新增 `tags` 数组参数，用子查询 `HAVING COUNT(DISTINCT dt.tag_id) = N` 实现标签 AND 过滤。
- `backend/src/api.js`：新增 `PUT /categories/:id`（重命名）；`GET /documents` 解析 `req.query.tags`（逗号分隔或数组）传入过滤。
- `frontend/src/api/client.js`：新增 `createCategory` / `updateCategory` / `deleteCategory` / `deleteTag` 封装。
- `frontend/src/views/KnowledgeBase.vue`：左侧分类目录新增行内重命名（hover 显形「改名」+ 回车提交）、hover 显形「删除」（删除前查该分类文档数并 `confirm` 提示受影响数量，确认后删除；当前选中则置空为「全部文档」）、「＋ 新建分类」行内输入（1–30 字）；右侧新增标签 chip 多选筛选 + 「清除筛选」，筛选随 `tags` 参数触发并实时刷新计数与列表；分类增删改派发 `kb-changed` 同步侧边栏。
- `frontend/src/views/DocumentEdit.vue`：标签输入框补充提示（逗号分隔、英文自动小写去重）。

### Verified
- `npm test`（backend）→ 5 suites / **80 tests 全过 / 0 fail**（store 34 + api 23 + 页面树 12 + 本次新增分类/标签用例 +11）。
- `npm run build`（frontend）→ 构建通过。
- 真实后端联调（curl，重置 dev 库后 seed）：`GET /api/documents?tags=zzalpha` → `total:3`（zz-X1/zz-R2/zz-R1）；`GET /api/documents?tags=zzalpha,zzbeta` → `total:1`（zz-R1）；`PUT /api/categories/1` 改名 → 200。
- 真实 Edge 浏览器（puppeteer-core，脚本置于 `.workbuddy/ui-verify` 不入库）7 项交互断言全过（点击标签 chip、仅 zzalpha→3 篇、zzalpha AND zzbeta→1 篇、分类重命名生效、分类删除生效）。
- 复盘：初版浏览器验证 5/7 FAIL（计数读到全部 17 篇），根因为后端进程为改动前陈旧实例（未重启、忽略 `tags`）；重启后端加载最新代码后复测 7/7 PASS，证实实现与前端均正确。

### Notes
- 覆盖 F-KB-004（分类新建/重命名/删除，删除置未分类）与 F-KB-005（标签小写合并、AND 过滤、单文档≤10）。
- 仍待 Codex 验收；浏览器交互式视觉验收需在浏览器手工确认。
- 未提交 Git（与既有改动一并待用户决定 push）；WorkBuddy 使用模型：MiniMax-M3；积分未提供，无法确认。

### 知识库页面树改造（Notion 功能形态，待 Codex 验收）

### Added
- `backend/src/migrations/002_page_tree.sql`：文档层级化——`documents` 新增 `parent_id`（自引用外键，`NULL`=顶层，`ON DELETE CASCADE`），并加 `idx_documents_parent_id` 索引。
- `backend/src/store.js`：新增 `validateParentId`（NULL/正整数校验）、`isSelfOrDescendant`（递归 CTE 防环）；`createDocument`/`updateDocument` 支持 `parent_id` 并在移动时防环；`getDocument` 返回 `path`/`child_count`/`descendant_count`；`listDocuments` 支持 `root`/`parent_id`；新增 `listDocumentTree`/`listChildren`。
- `backend/src/api.js`：`GET /documents` 支持 `root=1`/`parent_id=`；新增 `GET /documents/tree`、`GET /documents/:id/children`；`POST`/`PUT /documents` 接受 `parent_id`。
- `backend/src/store.test.js` / `backend/src/api.test.js`：新增页面树相关测试（共 +12 项断言）。
- `frontend/src/components/PageTree.vue`：递归页面树组件（展开箭头、hover ＋/···、行内重命名、缩进、active 高亮）。
- `frontend/src/components/DocIcon.vue`：单色描边 SVG 文件图标，替代 emoji。
- `frontend/src/App.vue`：侧边栏「页面」区块（PageTree + 新建页面）；页面 ··· 菜单（新建子页面/重命名/复制链接/删除）、删除确认含 `descendant_count`；展开状态 `localStorage` 持久化；`kb-changed` 事件同步刷新；进入自动展开当前页及祖先。
- `frontend/src/views/DocumentDetail.vue`：面包屑（知识库/祖先/当前页）+ 正文下方子页面列表 + ＋新建子页面入口 + 删除确认含 `descendant_count`。
- `frontend/src/views/DocumentEdit.vue`：父页面 select（层级缩进、编辑时排除自身及后代防环）；`?parent=` 预选；保存后派发 `kb-changed`。
- `frontend/src/api/client.js`：新增 `listDocumentTree`/`listChildren` 封装。

### Fixed
- `backend/src/migrate.js`：Windows 入口判断 `import.meta.url === file://${process.argv[1]}` 在反斜杠路径下恒 false 且 `runMigrations` 未 `await`，导致 002 迁移从未应用 → 改用 `pathToFileURL(process.argv[1]).href` 比较并 `await runMigrations`；`runMigrations` 报错设 `process.exitCode=1`。

### Verified
- `npm test` → 5 suites / **69 tests 全过 / 0 fail**。
- `npm run migrate` 现输出 `applied=1 versions=[2]`；`documents` 表含 `parent_id` 列。
- `npm run build`（frontend）→ 构建通过。
- 真实 Edge 浏览器（puppeteer-core，脚本置于 `.workbuddy/ui-verify` 不入库）16 项交互断言全过（树渲染/缩进/高亮、自动展开、子页面列表、面包屑、··· 菜单、行内重命名同步、新建子页面带 parent 参数、删除确认取消/确认、侧边栏自动刷新）。
- 演示数据：开发库灌入 10 篇文档（maxDepth=2）。

### Notes
- 应"按照 Notion 功能修改"（附 Notion 截图：侧边栏页面树 hover ＋/···、页面正文下方子页面列表）的要求；在前述 Notion 浅色外壳上改造为页面树 + 子页面形态。
- 仍待 Codex 验收；浏览器交互式视觉验收需在浏览器手工确认。未提交 Git；WorkBuddy 使用模型：MiniMax-M3；积分未提供，无法确认。

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

### TASK-005 Markdown 编辑与文档页面（实现 + 构建/联调，待 Codex 验收）

### Added
- `frontend/src/api/client.js`：统一 API 客户端，封装 fetch、相对 `/api` 前缀、网络错误标记（`err.network`）、204 无体处理；导出 `api` 对象（文档/分类/标签/渲染接口）。
- `frontend/src/views/KnowledgeBase.vue`：重写为真实数据列表——`GET /api/documents` 拉取（标题/分类/标签/更新时间）、启用「新建文档」入口、加载/错误/空状态、跳转详情与编辑。
- `frontend/src/views/DocumentEdit.vue`：新建/编辑页——标题（必填）/分类下拉/标签（逗号分隔）/Markdown 正文输入；`POST /api/markdown/render` 实时预览（后端净化）；保存按新建 POST / 编辑 PUT（带 version）；空标题 400 字段提示；409 冲突展示「加载最新（丢弃本地修改）/ 基于最新覆盖保存（二次确认）」双选项；sessionStorage 草稿恢复（断网/刷新不丢）。
- `frontend/src/views/DocumentDetail.vue`：详情页——拉取文档、`POST /api/markdown/render` 后端净化渲染（v-html 安全）、元数据展示、编辑入口、删除二次确认弹窗（显示标题，取消不删）。
- `frontend/src/App.vue`：新增全局 `.markdown-body` 排版样式，供编辑预览与详情页共用。
- `backend/src/api.js`：新增稳定的 `POST /api/markdown/render`（白名单净化，防存储型 XSS），从 `backend/src/index.js` 移除临时 `POST /api/_dev/render-markdown`（已合并）。

### Verified
- `npm run build`（frontend）→ 43 modules transformed，无报错。
- `npm test`（backend）→ 5 suites / 57 tests，全过 / 0 fail。
- 真实后端联调（curl）：渲染净化（`<script>`/`javascript:` 被剥离）；`_dev` 端点 404（已移除）；文档创建 201 / 读取 200 / 列表 `{total,items}`；错误版本更新 **409 + current 快照**；删除 204 后 GET 404。联调后清空开发库测试数据。

### Notes
- 覆盖 F-KB-001/002/003 的 UI 部分；浏览器交互式验收（冲突弹窗、草稿恢复、断网重试、双会话 409）属 FUNCTIONAL_SPEC 手工条目，需在浏览器执行，本会话仅完成构建与 API 契约层验证，不谎称交互验收已通过。
- 未提交 Git（与 TASK-002/003 一并待用户决定 push）；WorkBuddy 使用模型：MiniMax-M3；积分未提供，无法确认。

### 知识库 UI 风格改造（Notion 化，待 Codex 验收）

### Changed
- `frontend/src/App.vue`：外壳由深色改为 Notion 浅色风格（白色主区 + `#f7f7f5` 侧边栏 + `#37352f` 文本 + `#2383e2` 链接蓝）；侧边栏新增工作区头部与区块标签；全局 `markdown-body` 改为 Notion 阅读排版（浅色代码块、舒适行距、链接下划线）。
- `frontend/src/views/KnowledgeBase.vue`：列表视图——页面图标 + 大标题 + 新建按钮；新增**左侧分类目录**（全部文档 + 各分类，点击按 `category_id` 过滤，复用 `/categories` 与 `GET /documents?category_id=`）；文档行 hover 显形「打开 / 编辑」。
- `frontend/src/views/DocumentDetail.vue`：Notion 居中阅读列（max-width 760px），大标题 + 页面图标 + 标签 pill + 更新时间 + 版本；顶部 hover 显形「编辑 / 删除」。
- `frontend/src/views/DocumentEdit.vue`：无边框大标题输入 + 居中写作列；新增「编写 / 分屏 / 预览」模式切换，保留实时预览、草稿、409 冲突、空标题 400 等全部逻辑。
- `frontend/src/views/Home.vue` / `Tools.vue`：补上居中容器以匹配去 padding 的主区。

### Verified
- `npm run build`（frontend）→ 构建通过（各视图/客户端分块产物正常）。
- 启动 `backend`（:3000）+ `frontend`（:5173，Vite 代理 /api）实时预览；为演示灌入 3 篇示例文档 + 2 个分类（开发库演示数据，可清空）。

### Notes
- 仅改动前端视觉与模板结构，**未改动任何业务逻辑**（API 调用、保存/冲突/草稿/校验），功能等价此前 TASK-005 实现。
- 交互式视觉验收（列表视图、目录过滤、阅读/编辑页观感、模式切换）需在浏览器手工确认；本会话仅完成构建与本地联调启动。
- 演示数据非功能必需；如不需可清空开发库 `data/team-toolbox.sqlite3`（或删除种子文档/分类）。
- 仍未提交 Git；WorkBuddy 使用模型：MiniMax-M3；积分未提供，无法确认。

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
