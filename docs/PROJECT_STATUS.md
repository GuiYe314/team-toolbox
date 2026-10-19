# 项目状态（PROJECT_STATUS）— 唯一状态源

- 更新日期：2026-10-19（TASK-008 首页最近更新实现 + 后端 96/96 单测通过 + 真实浏览器 9/9 交互断言通过，待 Codex 验收）
- 本文件是项目进度的**唯一来源**；README 等文档只链接引用、不复制进度。更新规则见 [AGENTS](../AGENTS.md)。
- 仓库：https://github.com/GuiYe314/team-toolbox（私有）

## 1. 当前基线

**TASK-002 自测修复**：在原"已实现（待 Codex 验收）"基础上修复了 `migrate.js` 缺 `async` / `errors.js` 返回非 Error / `db.js` 缺 path 注入与 cannot_open 映射 / 测试多处因 better-sqlite3 子码与共享文件路径问题导致的失败。`npm test`（store）5 suites / 34 tests 全过；`/api/health` 200；`npm run migrate` 仍可用。**仍待 Codex 验收；不替 Codex 验收。**

**TASK-003 文档 CRUD API（本次实现）**：在 TASK-002 的同步存储层（`store.js`）之上新增 `api.js`（Express 路由 + 统一错误码→HTTP 状态码映射）、在 `index.js` 挂载，并新增 `api.test.js`（接口级自动化测试，23 tests 全过）。覆盖 F-KB-001/002/003 的 API 部分与分类/标签关联读写。接口级验证见第 4 节。**已实现 + 自测通过，待 Codex 验收；TASK-002 的 Codex 验收仍待补。**

**TASK-005 Markdown 编辑与文档页面（本次实现）**：在 TASK-003 API 与 TASK-004 前端框架之上，新增 `frontend/src/api/client.js`（统一封装 fetch、网络错误标记、204 无体处理）；重写 `KnowledgeBase.vue`（真实拉取文档列表、启用「新建文档」入口、加载/错误/空状态）、`DocumentEdit.vue`（标题/分类/标签/Markdown 正文输入 + 后端净化实时预览 + 保存 POST/PUT + 空标题 400 提示 + 409 冲突双选项【加载最新 / 基于最新覆盖保存（二次确认）】+ sessionStorage 草稿恢复）、`DocumentDetail.vue`（后端净化渲染、元数据展示、删除二次确认弹窗）。后端新增稳定的 `POST /api/markdown/render`（白名单净化，防存储型 XSS），并移除临时的 `_dev/render-markdown`（已合并）。`npm run build` 前端 43 模块构建通过；后端 `npm test` 57/57 通过；curl 联调覆盖创建/读取/列表/409/删除闭环与渲染净化（见第 4 节）。**已实现 + 构建/联调通过，待 Codex 验收；浏览器交互式验收（冲突 UI、草稿恢复、断网重试）需在浏览器手工执行。**

**知识库 UI 风格改造（Notion 化，本次）**：应"把知识库做成 Notion 样子"的要求，在不改动任何业务逻辑（API 调用、保存/冲突/草稿）的前提下，对前端做了整体视觉重设计，目标接近 Notion 的浅色文档风格：
- `App.vue`：改为浅色外壳——白色主区 + `#f7f7f5` 浅灰侧边栏 + `#37352f` 文本 + `#2383e2` 链接蓝；侧边栏增加工作区头部（📦 工具箱）+ 区块标签；全局 `markdown-body` 改为 Notion 阅读排版（浅色代码块、舒适行距、链接下划线）。
- `KnowledgeBase.vue`：Notion「列表视图」——页面图标(📚)+大标题+新建按钮；新增**左侧分类目录**（全部文档 + 各分类，点击按 `category_id` 过滤，复用 `/categories` 与 `?category_id=`）；文档行以页面图标 + 标题 + 分类/标签 pill + 更新时间呈现，hover 显形「打开 / 编辑」操作。
- `DocumentDetail.vue`：Notion 居中阅读列（max-width 760px），大标题 + 页面图标 + 标签 pill + 更新时间 + 版本；顶部 hover 显形「编辑 / 删除」。
- `DocumentEdit.vue`：Notion 式无边框大标题输入 + 居中写作列；新增「编写 / 分屏 / 预览」模式切换（默认分屏），保留实时预览、草稿、409 冲突、空标题 400 等全部逻辑。
- `Home.vue`/`Tools.vue`：补上居中容器以匹配无 padding 主区，沿用新调色板。
- 构建（`npm run build`）通过；为便于预览在开发库灌入 3 篇示例文档 + 2 个分类（演示数据，可清空）。**仍待 Codex 验收；交互式视觉验收需在浏览器手工执行。**

**知识库页面树改造（Notion 功能形态，本次）**：应"按照 Notion 功能修改"的要求（用户附 Notion 截图：侧边栏页面树 hover 显形 ＋/··· 菜单；页面正文下方列出子页面 + ＋新建子页面），在前述 Notion 浅色外壳基础上，把知识库改造为 Notion 式的**页面树 + 子页面列表**形态，新增文档父子层级：
- **数据层（迁移 002）**：`backend/src/migrations/002_page_tree.sql` —— `documents` 表新增 `parent_id`（自引用外键，`NULL`=顶层，`ON DELETE CASCADE` 级联删除子树），并加 `idx_documents_parent_id` 索引。
- **存储层 `store.js`**：新增 `validateParentId`（NULL/正整数校验）、`isSelfOrDescendant`（递归 CTE 防环）；`createDocument`/`updateDocument` 支持 `parent_id` 并在移动时做防环校验（不可把页面移到自身或后代之下）；`getDocument` 额外返回 `path`（祖先数组，根→父）、`child_count`、`descendant_count`；`listDocuments` 支持 `root`/`parent_id` 过滤；新增 `listDocumentTree`（扁平树，不含正文）、`listChildren`。
- **接口层 `api.js`**：`GET /documents` 支持 `root=1` / `parent_id=` 过滤；新增 `GET /documents/tree`、`GET /documents/:id/children`；`POST`/`PUT /documents` 接受 `parent_id`。
- **前端 `PageTree.vue`**（递归组件）：侧边栏多级可展开页面树，展开箭头（› 旋转）、hover 显形 ＋（新建子页面）与 ···（菜单）、行内重命名输入、缩进、`active` 高亮；`DocIcon.vue` 单色描边 SVG 文件图标替代 emoji。
- **`App.vue` 重写**：侧边栏「页面」区块（PageTree + ＋新建页面）；页面 ··· 菜单（新建子页面/重命名/复制链接/删除）、删除确认弹窗（提示 `descendant_count` 个子页面将连带删除）；展开状态 `localStorage` 持久化；`window` 事件 `kb-changed` 实现侧边栏与视图间刷新同步；进入页面自动展开当前页及祖先（focusActive）。
- **`DocumentDetail.vue` 重写**：顶部面包屑（知识库/祖先/当前页，可点击）、正文下方子页面列表（DocIcon + 标题，hover 下划线）、＋新建子页面入口、删除确认含 `descendant_count` 提示。
- **`DocumentEdit.vue` 修改**：新增「父页面」select（按层级缩进、编辑时排除自身及后代防环）；`mounted` 读取 `?parent=` 预选父页面；保存后派发 `kb-changed`。
- **`api/client.js`**：新增 `listDocumentTree` / `listChildren` 等封装。
- 修复 `migrate.js` Windows 入口判断（原 `import.meta.url === file://${process.argv[1]}` 在 Windows 反斜杠路径下恒 false 且未 `await`，导致迁移 002 从未应用）→ 改用 `pathToFileURL(process.argv[1]).href` 并 `await runMigrations`。
- 构建（`npm run build`）通过；后端 `npm test` **69/69 通过**（store 34 + api 23 + 新增页面树测试）；以真实 Edge 浏览器（puppeteer-core，置于 `.workbuddy/ui-verify`，不入库）跑 16 项交互断言全部 PASS（树渲染/缩进/高亮、自动展开、子页面列表、面包屑、··· 菜单、行内重命名同步、新建子页面带 parent 参数、删除确认取消/确认、侧边栏自动刷新）。为预览灌入 10 篇演示文档（编程→Unity→基础/技巧/插件/Shader Graph；编程→Git 等，maxDepth=2）。**仍待 Codex 验收；交互式视觉验收需在浏览器手工确认。**

**TASK-006 分类与标签（本次实现，覆盖 F-KB-004 / F-KB-005）**：在 TASK-003 的分类/标签关联读写与 TASK-005 前端框架之上，补齐分类管理与标签筛选的完整闭环：
- **分类管理（F-KB-004）**：后端 `store.createCategory` 新增分类数量上限 50（达上限返回 `invalid_input`）；新增 `store.updateCategory`（空名→`invalid_input`、重名→`constraint_failed`、不存在→`not_found`）；`api.js` 新增 `PUT /categories/:id`（重命名）、复用既有 `POST`/`DELETE /categories`。删除分类沿用 `ON DELETE SET NULL`（文档置为未分类，不级联删文档）。
- **标签规范化（F-KB-005 细则）**：`store.validateTags` 改为英文小写合并（`toLowerCase()`）+ 去首尾空白 + 去重（`[...new Set]`），单文档上限 10；`api/client.js` 新增 `createCategory`/`updateCategory`/`deleteCategory`/`deleteTag` 封装。`DocumentEdit.vue` 标签输入框补充提示（逗号分隔、英文自动小写去重）。
- **标签 AND 过滤（F-KB-005）**：`store.listDocuments` 支持 `tags` 数组参数，用子查询 `d.id IN (SELECT dt.document_id FROM document_tags dt JOIN tags t ON t.id=dt.tag_id WHERE t.name IN (...) GROUP BY dt.document_id HAVING COUNT(DISTINCT dt.tag_id) = N)` 实现"须同时包含所选全部标签"；`api.js` 的 `GET /documents` 解析 `req.query.tags`（逗号分隔或数组）传入过滤。`KnowledgeBase.vue` 右侧新增标签 chip 多选筛选 + 「清除筛选」，筛选随 URL 参数 `tags` 触发并实时刷新计数与列表。
- **前端分类管理 UI（F-KB-004）**：`KnowledgeBase.vue` 左侧分类目录新增行内重命名（hover 显形「改名」+ 回车提交）、hover 显形「删除」（删除前查该分类文档数并在 `confirm` 提示受影响数量，确认后删除；若当前选中则置空为「全部文档」）、「＋ 新建分类」行内输入（1–30 字，重名/超 50 上限由后端拒绝并提示）。分类增删改均派发 `kb-changed` 同步侧边栏刷新。
- 构建（`npm run build`）通过；后端 `npm test` **80/80 通过**（store 34 + api 23 + 页面树 12 + 本次新增分类/标签用例 +11）；以真实 Edge 浏览器（puppeteer-core，置于 `.workbuddy/ui-verify`，不入库）跑 7 项交互断言全部 PASS（点击标签 chip、仅 zzalpha→3 篇、zzalpha AND zzbeta→1 篇、分类重命名生效、分类删除生效）。**仍待 Codex 验收；交互式视觉验收需在浏览器手工确认。**

**TASK-007 搜索（本次实现，覆盖 F-KB-006）**：在 TASK-005/006 基础上补齐关键词搜索，作为知识库主要找回手段：
- **后端 `store.searchDocuments`**：关键词参数化 `LIKE`（标题 OR 正文，不区分大小写）；关键词中的 LIKE 通配符（`%`/`_`/`\`）统一转义为字面量并配合 `ESCAPE '\'`，防止意外通配与注入；空关键词直接返回空结果（不发起全表匹配）；结果按 `updated_at` 倒序、分页（默认 20，最大 100），每条附带 `snippet` 摘要片段（在正文折叠单行中定位关键词、取前后窗口，含省略号）。
- **接口 `api.js`**：新增 `GET /search?q=&limit=&offset=`；空关键词不发起查询、返回 `{total:0,items:[]}`；分页经 `clampInt` 限制。
- **前端 `api/client.js`**：新增 `api.search(q, {limit, offset})`（URLSearchParams 构造）。
- **前端 `KnowledgeBase.vue`**：用真实搜索框替换原「搜索即将在 TASK-007 开放」占位；输入防抖 300ms 切换搜索模式，结果渲染标题 / 摘要片段 / 分类 / 标签；无结果显示空状态「未找到与「q」相关的文档。查看全部文档」；分页「加载更多」；「清除」回到普通列表；点击分类或标签 chip 自动退出搜索模式。
- 中文搜索采用子串匹配（`LIKE '%kw%'`），契合中文无词边界特性，未引入 FTS5（ARCHITECTURE 第 9 节"搜索实现"待决策项据此落地为 LIKE 方案，文档后续同步）。
- 构建（`npm run build`）通过；后端 `npm test` **93/93 通过**（store 34 + api 23 + 页面树 12 + 分类标签 +11 + 本次搜索 +8）；以真实 Edge 浏览器（puppeteer-core，置于 `.workbuddy/ui-verify`，不入库）跑 8 项交互断言全部 PASS（搜索框、搜索「规范」→3 条且计数文案正确、清空回列表、无结果空状态、特殊字符「50%」不崩溃、清除按钮）。**仍待 Codex 验收；交互式视觉验收需在浏览器手工确认。**

**TASK-008 首页最近更新（本次实现，覆盖 F-KB-008）**：在 TASK-005/006/007 基础上补齐首页默认视图的"最近更新"区块，作为知识库活跃度的入口：
- **后端复用**：无需新增存储/接口——`store.listDocuments` 默认即 `ORDER BY updated_at DESC`、`limit 20`、`offset 0`；`GET /api/documents`（无过滤）直接返回全部文档按更新时间倒序，每件附带 `category_name` 与 `tags` 数组，天然满足 F-KB-008 的数据需求。
- **前端 `Home.vue`**：「最近更新」区块由静态占位改为真实数据驱动——`mounted` 调用 `api.listDocuments('?limit=20&offset=0')`（注意 `client.request` 返回 `{res, body}`，须取 `body`）；渲染每行标题 / 分类 pill / 标签 pill / 更新时间（`formatTime` 与知识库一致）；"查看更多"按 `offset` 增量分页（`hasMore = recent.length < recentTotal`）；点击条目跳转 `/kb/:id` 详情；空库显示空状态并引导「新建文档」（跳转 `/kb/new`）；加载中与加载失败（含「重试」按钮）状态齐备，失败不丢已有列表（内联错误条 + 重试加载更多）。
- **修复（被浏览器验证抓出）**：初版误用 `res.items`/`res.total`（`res` 实为 `{res, body}` 外层对象，`res.items` 恒 undefined → 列表恒空、误显空状态）；修正为读取 `body.items`/`body.total`，与 `KnowledgeBase.vue` 既有约定一致。
- 构建（`npm run build`）通过；后端 `npm test` **96/96 通过**（store 34 + api 23 + 页面树 12 + 分类标签 +11 + 搜索 +8 + 本次默认排序/分页/空结果 +4）；以真实 Edge 浏览器（puppeteer-core，置于 `.workbuddy/ui-verify`，不入库）跑 9 项交互断言全部 PASS（首屏 20 条、首条标题非空、含分类/标签 pill、存在「查看更多」、点击后 25 条、点击条目跳详情；空库空状态渲染、含「新建文档」按钮、点击跳转 `/kb/new`）。**仍待 Codex 验收；交互式视觉验收需在浏览器手工确认。**

## 2. 任务状态

当前开发阶段：阶段四（内容组织与查找）进行中（TASK-005 文档页面、TASK-006 分类与标签、TASK-007 搜索、TASK-008 首页最近更新均已实现 + 自测/构建/真实浏览器验证通过，待 Codex 验收）；TASK-002/003/004 已实现待 Codex 验收。功能阶段定义见 [开发计划](DEVELOPMENT_PLAN.md) 第 1 节；阶段一至六为第一版，阶段七、八为后续规划。

| 任务 | 状态 | 说明 |
|---|---|---|
| 文档基线（本批 9 个文件） | 完成 | 编写完成，自检见第 4 节 |
| TASK-001 技术栈决策与脚手架 | 完成（Codex 验收通过） | 沿用 2026-10-16 记录 |
| TASK-001 修复（Node.js 24 兼容） | 完成（Codex 验收通过） | 沿用 2026-10-16 记录 |
| TASK-002 服务端基础与持久化层 | **已实现 + 自测修复（待 Codex 验收）** | 本次 `npm test`（store）5 suites / 34 tests 全过；不宣称 Codex 验收通过 |
| TASK-003 文档 CRUD API | **已实现 + 接口测试通过（待 Codex 验收）** | 本次新增 `api.js`/`api.test.js`；`npm test`（api）23 tests 全过；覆盖 F-KB-001/002/003 API 部分 + 分类/标签关联读写 |
| TASK-004 前端框架与导航布局 | **已实现（本次前端构建验证通过，作为 TASK-005 宿主；待 Codex 验收）** | 侧边导航 / 首页 / 知识库 / 工具箱 / 工具空状态 / 404 框架落地；本次随 TASK-005 验证 `npm run build` 通过 |
| TASK-005 Markdown 编辑与文档页面 | **已实现 + 构建/联调通过（待 Codex 验收）** | 本次实现 `api/client.js` 与三个文档视图 + 后端 `POST /api/markdown/render`；后续追加 Notion 风格 UI 改造（浅色外壳 / 列表视图 + 分类目录 / 居中阅读 / 写作模式切换） |
| TASK-006 分类与标签 | **已实现 + 单测/浏览器验证通过（待 Codex 验收）** | 本次补齐分类新建/重命名/删除（50 上限、重名拒绝、删除置未分类）+ 标签小写合并去重 + 标签 AND 过滤 + 前端分类管理/标签筛选 UI；后端 `npm test` 80/80 全过，真实浏览器 7/7 交互断言 PASS |
| TASK-007 搜索 | **已实现 + 单测/浏览器验证通过（待 Codex 验收）** | 本次新增 `store.searchDocuments`（标题/正文参数化 LIKE、通配符转义防注入、updated_at 倒序分页、snippet 摘要）+ `GET /api/search` + 前端搜索框/结果/空状态/分页/清除；后端 `npm test` 93/93 全过，真实浏览器 8/8 交互断言 PASS |
| TASK-008 首页最近更新 | **已实现 + 单测/浏览器验证通过（待 Codex 验收）** | 本次接线 `Home.vue` 到 `listDocuments` 默认排序（updated_at 倒序、limit 20）+ 分页「查看更多」+ 空状态/错误重试；后端 `npm test` 96/96 全过，真实浏览器 9/9 交互断言 PASS |
| TASK-009 备份导出与恢复 | 未开始 | 依赖 TASK-002 |
| TASK-010 MVP 集成验收 | 未开始 | 依赖 TASK-005~TASK-009 |
| TASK-D01 实时共同编辑（延期） | 未开始 | 阶段八，依赖 TASK-D02 与协同方案确认 |
| TASK-D02 账号与权限（延期） | 未开始 | 阶段七，依赖 TASK-010 与账号方案确认 |

> 注：本次「页面树 / Notion 功能形态改造」（用户 2026-10-19 截图驱动）不属于上述编号任务，作为 TASK-005 Notion 化之上的功能性延伸，已实现 + 构建/浏览器自动化验证通过，**待 Codex 验收**；详见第 1 节与第 4 节。

数据库方案已确定为 SQLite（2026-10-16，用户指定）；驱动 = better-sqlite3；迁移 = 手写 NNN_xxx.sql + `schema_migrations` 表；建表初版（001_init.sql）已实装；业务读写层（TASK-002 存储层 + TASK-003 HTTP 接口）已实现并自测通过。

## 3. 下一任务

**纪律说明（更新于 2026-10-19）**：TASK-002 / TASK-003 已实现并自测通过、TASK-004 前端框架已实现、TASK-005 本次实现并构建/联调通过，但 TASK-002/003/004/005 **仍待 Codex 正式验收**，不宣称验收通过。依用户 2026-10-19 多次 "继续" 指令，在自测通过基础上逐次推进了 TASK-003、TASK-005；阶段四（TASK-006/007/008）可在 TASK-005 之后启动，但 MVP 集成验收（TASK-010）前应补齐 TASK-002~005 的 Codex 验收与浏览器交互式验收。

**下一任务**：TASK-009（备份导出与恢复，F-KB-007 导出部分 / F-OPS-002）、TASK-010（MVP 集成验收，阶段门槛）。正式开工前建议先补齐 TASK-002~008 的 Codex 验收。

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
- TASK-002/003/004/005 与本次「页面树 / Notion 功能形态改造」的 **Codex 正式验收** 仍待补（本会话只做自测与构建/联调）；TASK-005 与页面树的浏览器交互式验收亦待补。

**TASK-005 实际验证摘要（2026-10-19，Windows + Node.js v22.22.2）**：

- **前端构建**：`npm run build`（frontend）→ 43 modules transformed，输出 `dist/index.html` 与各视图/客户端分块 JS/CSS，未报错；验证 Vue 3 SFC 与新增 `api/client.js` 可正常编译打包。
- **后端测试**：`npm test` → 5 suites / 57 tests（store 34 + api 23），**全过 / 0 fail**（新增 `POST /api/markdown/render` 路由随整体测试通过，由联调补充覆盖）。
- **真实后端联调**（启动 `node src/index.js`，curl 验证）：
  - `POST /api/markdown/render`（含 `<script>alert(1)</script>` 与 `[坏链接](javascript:alert(1))`）→ 返回 HTML 中 `<script>` 被剥离、外链 `href` 被丢弃仅保留 `rel="noopener noreferrer"`，安全渲染通过（F-KB-002 安全考量）。
  - 旧 `POST /api/_dev/render-markdown` → **404**（已移除并合并至稳定路由）。
  - `POST /api/documents` → 201 `{id, version:1, ...}`；`GET /api/documents/:id` → 200 含 `content_md`/`version`/`tags:[]`/`category_id:null`；`GET /api/documents?limit=5` → 200 `{total:1, items:[...]}`。
  - `PUT /api/documents/:id` 错误版本 → **409** `{error:"conflict", current:{...}}`（F-KB-002 冲突语义通过），前端据此展示「加载最新 / 基于最新覆盖保存（二次确认）」双选项。
  - `DELETE /api/documents/:id` → 204，再次 `GET` → 404（F-KB-003 删除语义通过）。
  - 验证后已清理开发库中的测试文档，`data/team-toolbox.sqlite3` 恢复为空库。
- **TASK-005 范围边界（明确不在本次）**：
  - 浏览器交互式验收（冲突弹窗点击、sessionStorage 草稿恢复、断网重试、双会话 409 复现、含 `<script>` 文档渲染不执行）属 FUNCTIONAL_SPEC 的手工验收条目，需在浏览器执行；本会话仅完成构建与 API 契约层验证，不谎称交互验收已通过。
  - 分类管理 UI 的「新建/重命名/删除」、标签小写合并与 AND 过滤——**已于 TASK-006 实现**（见上文 TASK-006 条目与验证摘要）。搜索（F-KB-006）、首页最近更新（F-KB-008）属 TASK-007/008，本次未实现（编辑页已预留分类下拉与标签输入框，仅消费既有分类）。

**页面树 / Notion 功能形态 实际验证摘要（2026-10-19，Windows + Node.js v22.22.2）**：

- **后端单元/接口测试**：`npm test` → 5 suites / **69 tests 全过 / 0 fail**（store 34 + api 23 + 本次新增页面树相关用例共 +12 项）。覆盖：`parent_id` 校验（NULL/正整数/不存在→invalid_input）、`getDocument` 返回 `path`/`child_count`/`descendant_count`、`listChildren`/`listDocumentTree`/`root` 过滤、`updateDocument` 移动与防环（不可移到自身/后代→invalid_input）、删除级联（`ON DELETE CASCADE` 后子树查询 404）。
- **接口级验证（api.test.js）**：POST 带 `parent_id`、children、tree、root=1、PUT 防环 400、DELETE 级联 404 等 7 项断言全过。
- **迁移修复验证**：`migrate.js` Windows 入口改用 `pathToFileURL(process.argv[1]).href` 并 `await`，`npm run migrate` 现输出 `applied=1 versions=[2]`，`documents` 表确已含 `parent_id` 列（此前该迁移在 Windows 下从未真正应用）。
- **前端构建**：`npm run build`（frontend）→ 全部模块构建通过（含新增 `PageTree.vue`/`DocIcon.vue`/递归组件与路由分块），无报错。
- **真实浏览器交互验收（puppeteer-core + 本机 Edge headless，脚本置于 `.workbuddy/ui-verify`，不入库）**：16 项交互断言全部 PASS——页面树渲染/多级缩进（8px/24px/40px）/当前页高亮；进入页面自动展开当前页及祖先；正文下方子页面列表与面包屑可点击；页面行 hover 显形 ＋/··· 菜单；行内重命名同步（Ctrl+A 覆盖，标题不叠加）；新建子页面带 `?parent=` 路由参数；删除确认弹窗显示 `descendant_count` 且取消/确认均正确；侧边栏经 `kb-changed` 事件自动刷新。
- **演示数据**：为预览在开发库 `data/team-toolbox.sqlite3` 灌入 10 篇文档，构成 `编程 → Unity → {基础,技巧,插件,Shader Graph}`、`编程 → Git` 等层级（maxDepth=2）。演示数据非功能必需，可清空。

范围边界（明确不在本次）：
- 页面「复制链接」实现为复制前端路由 URL（非分享型短链）；重命名/移动等仅前端触发 API，未做撤销。
- 浏览器交互式视觉验收（树观感、菜单、面包屑样式）已用自动化断言覆盖交互逻辑，但纯视觉审美仍需人工确认。
- 本会话仅做自测 + 构建 + 真实浏览器自动化断言；**Codex 正式验收仍待补**，不宣称验收通过。

**TASK-006 实际验证摘要（2026-10-19，Windows + Node.js v22.22.2）**：

- **后端单元/接口测试**：`npm test` → 5 suites / **80 tests 全过 / 0 fail**（store 34 + api 23 + 页面树 12 + 本次新增分类/标签用例 +11）。覆盖：分类新建（重名→`constraint_failed`、超 50 上限→`invalid_input`）、`updateCategory` 重命名（成功/重名 409/不存在 404/空名 400）、标签归一（`toLowerCase`+去空白+去重，`[...new Set]`）、`listDocuments` 按 `tags` 的 AND 过滤子查询（`GROUP BY ... HAVING COUNT(DISTINCT tag_id) = N`）；接口层 `PUT /categories/:id` 重命名 200 / 重名 409 / 不存在 404、`GET /documents?tags=` 按标签 AND 过滤（zzalpha→3 篇、zzalpha+zzbeta→1 篇）。
- **真实后端联调**（curl，重置 dev 库后 seed 验证）：`GET /api/documents?tags=zzalpha` → `total:3`（zz-X1/zz-R2/zz-R1）；`GET /api/documents?tags=zzalpha,zzbeta` → `total:1`（zz-R1）；`PUT /api/categories/1` 改名 → 200。
- **前端构建**：`npm run build`（frontend）通过，新增 `KnowledgeBase.vue` 分类管理/标签筛选分块无报错。
- **真实浏览器交互验收（puppeteer-core + 本机 Edge headless，脚本置于 `.workbuddy/ui-verify`，不入库）**：7 项交互断言全部 PASS——点击 `#zzalpha` chip 成功；仅 zzalpha→3 篇（R1/R2/X1）；zzalpha AND zzbeta→1 篇（R1）；分类 `zzcatR` 存在；分类重命名生效（zzcatR→zzcatR改）；分类 `zzcatD` 存在；分类删除生效（zzcatD 消失）。
- **本次验证复盘**：初版真实浏览器验证曾 5/7 FAIL（两个计数断言读到全部 17 篇），根因是后端进程为改动前的**陈旧实例**（未重启，忽略 `tags` 参数）；重启后端加载最新 `store.js`/`api.js` 后复测即 7/7 PASS，证实实现与前端均正确，非前端 bug。

范围边界（明确不在本次）：
- TASK-006 的 Codex 正式验收仍待补；浏览器交互式"视觉审美"仍需人工确认（自动化断言已覆盖交互逻辑）。
- 标签删除（`DELETE /tags/:id`）解除文档关联已实现并封装至客户端，但未在本次浏览器断言中专门点击验证；由单测（`deleteTag` 关联清理）覆盖。

**TASK-007 实际验证摘要（2026-10-19，Windows + Node.js v22.22.2）**：

- **后端单元/接口测试**：`npm test` → 5 suites / **93 tests 全过 / 0 fail**（store 34 + api 23 + 页面树 12 + 分类标签 +11 + 本次搜索 +8）。覆盖：标题关键词命中、正文关键词命中、未命中空结果、空关键词返回空（不发起全表匹配）、大小写不敏感（react→React）、LIKE 通配符字面量匹配（`100%` 仅命中字面、不被当作通配）、`snippet` 摘要生成、`updated_at` 倒序；接口层 `GET /api/search?q=` 命中/空关键词 200 空结果/特殊字符（`50%`）不 500/未命中空结果。
- **真实后端联调**（curl，dev 库演示数据）：`?q=规范` → `total:3`（Git 提交规范/组件设计规范/前端代码规范（草案））；`?q=Unity` → `total:1`；`?q=50%`（特殊字符）→ `total:0` 无报错；空关键词 → `{total:0,items:[]}`。
- **前端构建**：`npm run build`（frontend）通过（KnowledgeBase 分块 10.93kB）。
- **真实浏览器交互验收（puppeteer-core + 本机 Edge headless，脚本置于 `.workbuddy/ui-verify`，不入库）**：8 项交互断言全部 PASS——搜索框存在；搜索「规范」计数文案「搜索「规范」· 3 条结果」正确、结果行 3 条、含命中标题；清空回到普通列表（「10 个文档」）；无结果空状态「未找到与「…」相关的文档」；特殊字符「50%」不崩溃（0 条结果）；清除按钮存在。
- **决策落地**：中文搜索采用子串 `LIKE '%kw%'`（契合中文无词边界），未引入 FTS5；ARCHITECTURE 第 9 节"搜索实现"待决策项据此明确为 LIKE 方案，文档同步更新。

范围边界（明确不在本次）：
- TASK-007 的 Codex 正式验收仍待补；浏览器交互式"视觉审美"仍需人工确认（自动化断言已覆盖交互逻辑）。
- 搜索与分类/标签过滤相互独立（本次未做组合筛选）；组合筛选可后续按需扩展。

**TASK-008 实际验证摘要（2026-10-19，Windows + Node.js v22.22.2）**：

- **后端单元/接口测试**：`npm test` → 5 suites / **96 tests 全过 / 0 fail**（store 34 + api 23 + 页面树 12 + 分类标签 +11 + 搜索 +8 + 本次默认排序/分页/空结果 +4）。覆盖：`listDocuments` 默认按 `updated_at` 倒序（三篇文档相对顺序 fresh<mid<old，避免与其他用例数据干扰）；分页（limit 3 首/二页均 ≤3、total≥5）；空结果（不存在分类筛选得 `{total:0,items:[]}`）；接口层 `GET /api/documents` 默认排序与分页（limit 2 首/二页各 2、total≥5）、响应形态（`category_name`/`tags` 数组/`updated_at` 字段齐备）。
- **前端构建**：`npm run build`（frontend）通过（Home 分块 4.34kB JS / 4.61kB CSS）。
- **真实浏览器交互验收（puppeteer-core + 本机 Edge headless，脚本置于 `.workbuddy/ui-verify`，不入库）**：
  - populated 场景（dev 库 seed 25 篇）：6/6 PASS——首屏渲染 **20** 条（默认 limit）；首条标题非空；文档含分类/标签 pill；存在「查看更多」按钮；点击后渲染 **25** 条（分页生效）；点击首条跳转到 `/kb/23` 详情。
  - empty 场景（dev 库空）：3/3 PASS——空状态渲染；含「新建文档」按钮；点击跳转 `/kb/new`。
  - 合计 **9/9 PASS**。
- **本次验证抓出前端 bug**：初版 `Home.vue` 误用 `res.items`/`res.total`（`client.request` 返回 `{res, body}`，`res` 为外层对象，`res.items` 恒 `undefined` → 列表恒空、误显空状态）；修正为读取 `body.items`/`body.total` 后复测 9/9 PASS。证实端到端路径正确，且再次印证"真实浏览器验证"纪律对捕获前端 bug 的必要性（与 TASK-006 陈旧后端进程教训互补）。

范围边界（明确不在本次）：
- TASK-008 的 Codex 正式验收仍待补；浏览器交互式"视觉审美"仍需人工确认（自动化断言已覆盖交互逻辑）。
- 首页「最近更新」与搜索、分类/标签筛选相互独立（首页不接入筛选/搜索），符合 F-KB-008 仅要求"默认视图展示最近更新"的边界。

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
