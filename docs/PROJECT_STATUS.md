# 项目状态（PROJECT_STATUS）— 唯一状态源

- 更新日期：2026-10-20（新增「资源管理」子系统：Asset/AssetVersion/Folder 数据模型 + 三栏界面 + PreviewManager 预览体系 + 上传队列与同名冲突决策 + **资源保存路径（镜像目录）设置** + **资源导入导出**；后端 `npm test` 227/227、新增 `verify-assets` 30/30 与 `verify-asset-storage` 32/32、前端回归 233/233，待 Codex 验收；同日另含知识库/首页文档卡片网格 18/18 与 v-hint 悬停提示 20/20）
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

**详情页切换修复与导航层级调整（本次修复，待 Codex 验收）**：针对用户反馈"点击左侧页面按钮，右侧页面信息没反应"与"二级页面不要出现在一级页面上，改为在右侧生成列表"，做了三处改动：
- **修复 `DocumentDetail.vue`**：详情 → 详情 切换时 Vue Router 复用组件实例、`mounted` 不再触发，原实现导致 URL 已变而右侧仍显示上一篇文档。新增 `watch: { docId(id, oldId) }`，参数变化时清空 `doc`/`renderedHtml`/`children` 并重新加载。此前验证只覆盖"首页 → 详情"（首次挂载）故漏检，已补"详情 → 详情"回归断言。
- **侧边栏层级调整**：`PageTree.vue` 由递归多级树退化为**扁平一级页面列表**（移除子级递归、展开箭头、`expanded`/`toggle` props/emits）；`App.vue` 把页面列表移入导航区内、紧跟「知识库」之后，`v-if="onKbSection"`（`$route.path.startsWith('/kb')`）——**仅知识库区块显示**并缩进 22px 作为二级列表；同步删除 `expanded` 状态与 `localStorage` 折叠记忆（`loadExpanded`/`saveExpanded`/`toggleNode`/`focusActive`）。
- **右侧子页面列表**：`DocumentDetail.vue` 正文下方「子页面」区块增加标题与数量徽标、顶部分隔线与卡片容器 `.child-list`，二级页面统一在此查看与新建。
- 验证：真实 Edge（CDP）断言全 PASS——首页/工具箱下页面列表隐藏（0 行）、`/kb` 与 `/kb/4` 显示 10 篇顶层且无子页面「方法」与展开箭头、`/kb/10` 右侧「子页面 1」含「方法」、`/kb/4 → /kb/3` 标题正确切换、控制台 0 异常；`npm run build` 通过。`.workbuddy/` 已加入 `.gitignore`。**仍待 Codex 验收。**

**TASK-011 工具箱首个工具「比例锁定」（本次实现，用户新增范围）**：用户明确要求工具箱先做一个"锁定比例"工具——输入 `1920*1080` 锁定比例后，再输入 520 即自动按比例换算出 292.5。该需求超出原计划（工具箱第一版仅保留框架，见 [开发计划](DEVELOPMENT_PLAN.md) 第 1 节），单独记为 TASK-011，不影响既有任务与特性矩阵：
- **`frontend/src/views/RatioLock.vue`（新增）**：三步式交互——① 原始尺寸（兼容 `* x × , 空格` 分隔，也支持宽/高分框输入，内置 16:9 / 9:16 / 4:3 / 3:4 / 1:1 / 21:9 预设）；② 「锁定当前比例」按钮，显示最大公约数约分后的比例（如 1920×1080 → 16:9，附 `1 : 0.5625`），可再次点击解锁；③ 按比例换算，输入目标宽度自动得高度、反之亦然，结果卡片大字号展示并支持一键复制。
- **计算与精度**：结果统一按两位小数显示并去掉浮点噪声（`924.4444…` → `924.44`）；结果非整数时在下方提示精确值与"已按两位小数显示"。非法输入（非数字 / 非两段 / 非正数）行内报错且不进入锁定；锁定状态下修改原始尺寸或切换预设会同步更新基准比例并重算已填值。
- **接线**：`router/index.js` 新增 `tool-ratio-lock`；`Tools.vue` 卡片新增「比例锁定」并置于首位，状态徽标区分「可用 / 规划中」、按钮文案区分「打开工具 / 查看详情」。
- 纯前端计算，不涉及后端与数据存储。验证：真实 Edge（CDP）8 项断言全 PASS（卡片置首/可用、`1920*1080` 自动拆分、锁定显示 16:9、520 → 292.5、反向 520 → 924.44、非法输入报错、预设 1:1 同步基准、解锁回占位），控制台 0 异常，`npm run build` 通过。**已实现 + 浏览器验证通过，待 Codex 验收。**

**TASK-009 备份导出与恢复（本次实现，用户新增需求）**：用户要求"做个导入导出数据的设置按钮"。
- **备份格式（`backend/src/store.js`）**：新增 `BACKUP_VERSION = 1` 与 `exportSnapshot()` / `importSnapshot()`。快照**刻意使用名称与相对引用而非自增 ID**——分类与标签按名称、文档父子关系按 `ref` / `parent_ref`——因此备份文件可跨库、跨机器还原，不绑定某一台机器的 ID 序列。
- **导入语义**：合并模式，不删除既有数据；分类按名称复用或新建（受 50 上限约束）；文档以"同父级下同名"判定已存在并跳过，**因此重复导入同一份备份是幂等的**；逐层推进重建父子层级，父级缺失或成环的文档降级为顶层导入并记入 `details`，保证数据不丢；新建后还原 `created_at` / `updated_at`。
- **接口**：`GET /api/backup/export` 返回全量快照；`POST /api/backup/import` 接收快照返回 `{ imported, skipped, categories_created, details }`。`index.js` 的 JSON body 限制由 2mb 放宽至 16mb（原值不足以承载较大知识库导入）。
- **前端**：`api/client.js` 新增 `exportBackup` / `importBackup`；`KnowledgeBase.vue` 列表工具栏新增「导出 / 导入」按钮——导出 fetch → Blob → 本地下载 `team-toolbox-backup-<时间戳>.json`（不在服务端落盘），导入走隐藏 file input → 解析校验 → `confirm` 确认 → POST → 提示新增/跳过/新建分类数量，并刷新分类、标签、页面树与列表（派发 `kb-changed`）。
- **过程中修复两个真实缺陷**：① `importSnapshot` 跳过已存在页面时未登记 `ref → 既有 ID` 映射，使其子页面误判"父级缺失"而降级为顶层，重复导入会产生重复页面；② 前端 `:disabled="ioBusy"` 因 `ioBusy` 空字符串在 Vue 3 中为真，导致导出/导入按钮**永久禁用无法点击**。
- 验证：后端 `npm test` **100/100 通过**（新增 4 组备份用例）；curl 联调导出 13 篇/3 分类、原样重导入 `imported:0 skipped:13`、新数据 3 篇正确重建层级与分类；真实浏览器 CDP **10/10 交互断言 PASS**，控制台 0 异常，`npm run build` 通过。**待 Codex 验收；备份脚本与恢复演练文档尚未编写。**

## 2. 任务状态

**TASK-012 Markdown 图片附件 + 备份导出可选 gzip（本次实现，用户新增范围）**：用户要求"Markdown 需要增加图片添加功能"并"可以导出 .gzip"。
- **图片存储方案**（与用户确认）：图片以独立文件存 `<项目根>/data/uploads/`，Markdown 正文存 `![alt](/api/uploads/xxx.png)` 链接。**不采用 base64 内嵌**（会让 Markdown 不可读且正文暴涨）。代价：备份 JSON 只含图片链接，换机器恢复需另行拷贝 `data/uploads/` 目录。
- **后端 `uploads.js`**：文件名完全由服务端生成（`时间戳-16位hex.扩展名`），杜绝路径穿越；`resolveUploadPath` 用正则白名单 + `path.relative` 边界校验。类型校验为**扩展名白名单 + 文件魔数双重校验**，改名伪装也会被拒；默认拒绝 SVG（可内嵌脚本）。不限制单张体积（用户要求），仅 512MB 兜底防止内存打满。
- **接口**：`POST /api/uploads`（multipart，字段名 `image`）、`GET /api/uploads/:filename`（长缓存）。
- **编辑器 `DocumentEdit.vue`**：三种插图入口——工具栏按钮、**Ctrl+V 粘贴剪贴板截图**、拖拽到编辑区；上传后在光标处自动插入 Markdown，alt 取自文件名。
- **导出格式菜单**：`GET /backup/export?format=gz` 返回原始 gzip 字节（**刻意不设 `Content-Encoding: gzip`**，否则浏览器自动解压后拿不到可保存的压缩流）；前端下拉菜单二选一。导入端按 **gzip 魔数**（非扩展名）识别，用浏览器内置 `DecompressionStream` 解压。
- **修复三个真实缺陷**：① `resolveUploadPath` 用 `startsWith(dir + '/')` 做边界检查，而 Windows 分隔符是 `\`，导致**所有上传成功的图片都读不回（404）**，改用 `path.relative`；② `UPLOAD_DIR` 按 `process.cwd()` 解析会落到 `backend/data/` 与数据库目录错配，改为与 `db.js` 一致用 `PROJECT_ROOT`；③ Express 5 的 `req` 无 `formData()`（运行时 TypeError），改用 busboy 解析 multipart。
- **体积实测结论**（回答用户"数据多了 JSON 会不会很大"）：知识库存储引擎是 **SQLite**（`data/team-toolbox.sqlite3`），JSON 仅为导出格式。2000/10000 页压力测试：JSON 明文 ≈ SQLite 的 0.94 倍（**没有膨胀**），gzip 后约为 SQLite 的 0.9%（10000 页 14.56MB → 127KB）；exportSnapshot 约 9µs/页。当前规模远未到瓶颈，真正限制是导出一次性读入内存（十万页级才需流式）。
- 验证：后端 `npm test` **106/106 通过**（新增 6 组用例）；真实浏览器 CDP **17/17 交互断言 PASS**（含预览区图片真实加载非破图、gz 魔数校验、`.gz` 导入重建层级）；`npm run build` 通过，控制台 0 异常。**待 Codex 验收。**

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
| TASK-009 备份导出与恢复 | **已实现 + 单测/浏览器验证通过（待 Codex 验收）** | 本次实现 `store.exportSnapshot`/`importSnapshot`（跨库可移植格式：分类名/标签名 + `ref`/`parent_ref` 相对引用）+ `GET /api/backup/export`、`POST /api/backup/import` + 知识库页「导出/导入」按钮；后端 `npm test` 100/100 全过，真实浏览器 10/10 交互断言 PASS。**备份脚本/恢复演练文档尚未编写** |
| TASK-010 MVP 集成验收 | 未开始 | 依赖 TASK-005~TASK-009 |
| TASK-011 工具箱首个工具（比例锁定） | **已实现 + 单测/浏览器验证通过（待 Codex 验收）** | 用户新增范围：`RatioLock.vue` 三步式比例换算；真实浏览器 8/8 交互断言 PASS |
| TASK-012 图片附件与 gzip 导出 | **已实现 + 单测/浏览器验证通过（待 Codex 验收）** | 用户新增范围：Markdown 插图（按钮 / Ctrl+V 粘贴 / 拖拽三种入口）+ 导出可选 `.json.gz`；后端 `npm test` 106/106 全过，真实浏览器 17/17 交互断言 PASS |
| TASK-D01 实时共同编辑（延期） | 未开始 | 阶段八，依赖 TASK-D02 与协同方案确认 |
| TASK-D02 账号与权限（延期） | 未开始 | 阶段七，依赖 TASK-010 与账号方案确认 |

> 注：本次「页面树 / Notion 功能形态改造」（用户 2026-10-19 截图驱动）不属于上述编号任务，作为 TASK-005 Notion 化之上的功能性延伸，已实现 + 构建/浏览器自动化验证通过，**待 Codex 验收**；详见第 1 节与第 4 节。
>
> 注 8：2026-10-20 **统一修复所有浮层的定位**（上一轮「更多操作菜单跑到视口外」问题的系统性排查与收尾）。根因是 `.main-content` / `.main-sidebar` / `.page-sidebar` 三个 `.glass-panel` 上的 `backdrop-filter` 按 CSS 规范会创建**包含块**，使后代 `position: fixed` 改为相对该元素而非相对视口定位。实测受影响并已全部修复的浮层：资源页预览弹窗（修复前 x=337 w=1255 → 修复后 x=102 w=1496，即视口 88%）、所有 `.overlay` 遮罩（修复前只覆盖主内容区 → 修复后铺满视口 0,0,1700×1050）、存储路径与二维码弹窗（中心偏差从 250px 归零）、知识库删除确认、Markdown 帮助、App 删页面确认，以及上轮已修的资源与文件夹右键菜单。统一修法为全部 `<Teleport to="body">` —— 这是本项目的硬约束：既然用了玻璃拟态，所有 `position: fixed` 浮层都必须 Teleport 到 body。**这条约束应作为后续新增浮层的默认做法。**新增 `verify-overlay-position.mjs` 16/16（判据用可观测事实：遮罩是否铺满视口、弹窗中心是否与视口中心重合、预览弹窗是否 88%），前端回归 313/313。**待 Codex 验收**。
>
> 注 7：2026-10-20 资源管理页两处交互修正。**① 批量功能改为显式开关**：工具栏新增「批量」按钮，只有开启批量模式才显示复选框列与批量操作条（改前每行常驻一个空框，视觉噪声大且「点行 = 开详情」的主路径语义被稀释）；关闭批量模式时清空选择；批量模式下点行只切换选中、不打开详情（否则勾选一批时右侧详情不断跳）。**② 修复「更多操作」菜单位置**：根因是 `.main-content` 上的 `backdrop-filter: blur(30px)` 按 CSS 规范会创建**包含块**，使后代 `position: fixed` 改为相对该元素而非相对视口定位 —— 菜单按视口算出 `left=1397px`，实际却渲染在 `1648px`（差值恰为 main-content 的 250px 偏移），整块菜单跑到视口外完全看不见。修法用 `<Teleport to="body">` 脱离包含块，并同步改进定位策略（先渲染再测量而非硬编码宽度、右边缘对齐按钮右边缘、用 `ref` 而非 `querySelector` 取元素、定位完成前隐藏防闪烁）。新增 `verify-batch-mode.mjs` 21/21，前端回归 297/297。**待 Codex 验收**。
>
> 注 6：2026-10-20 新增**二维码分享**能力。页面二维码入口在主导航底部（所有页面通用）与资源管理页工具栏，扫后手机打开当前页面；每个资源（List 每行 + Grid 卡片悬浮）另有下载二维码，扫后手机直接下载该文件（下载地址带 `?download=1`，服务端返回 `Content-Disposition: attachment`）。**关键设计**：手机扫码必须能访问到服务器，而浏览器地址栏的 `127.0.0.1` 指向手机自己 —— 因此引入「对外访问地址」配置（存 localStorage，属部署环境相关不进数据库），未配置时 UI 明确提示需填本机内网 IP。二维码用 SVG 而非 PNG（矢量不模糊、体积小、颜色可控能跟随主题），qrcode 库动态 import 拆为独立 chunk（主 chunk 152.74KB → 127.14KB）；深色主题下前景色反转为浅色，否则深底深码扫不出来。资源下载二维码优先指向 **published** 版本（对外应给正式发布那版，而非草稿中的最新版）。新增 `verify-qr-share.mjs` 18/18，前端回归 276/276。**待 Codex 验收**。
>
> 注 5：2026-10-20 资源管理子系统完成 **Preview Pipeline**（服务端生成预览与缩略图）。架构为「处理器注册表」—— `backend/src/asset-preview.js` 独立模块，管线调度与具体处理分离，新增类型只需加一项处理器。当前实现五类：图片（sharp，生成 ≤1600px WebP 预览图 + 256×256 缩略图，实测压缩比 84x/42x）、3D 模型（解析 GLB/glTF 统计 meshes/vertices/triangles/materials/animations）、文本（截断预览，JSON 自动格式化）、音频（WAV 头解析时长）、视频（**本机无 ffmpeg，如实报 failed 并保留处理器位置**）。四条不变量：① 每个版本派生文件独立存放于 `<assetId>/<versionId>/`，绝不与其它版本共享；② 预览失败**不影响原件**，只改 `preview_status`/`preview_error`；③ 上传后异步生成不阻塞响应（pending → processing → ready/failed）；④ 服务启动时 `backfillPreviews` 补跑存量资源（管线接入前的旧数据否则永远停在 pending）。前端配套：缩略图判断改为「服务端是否真生成了」、详情面板显示预览状态徽标（失败带原因 + 重试按钮）并轮询状态。验证：新增 `asset-preview.test.js` 14/14 与 `verify-asset-preview.mjs` 23/23，后端 `npm test` 243/243、前端回归 258/258。**待 Codex 验收**。
>
> 注 4：2026-10-20 资源管理子系统追加两块功能（用户新增范围）。**① 资源保存路径设置**：语义为「镜像目录」而非主存储切换 —— 主存储（data/assets）永远保留为服务端权威副本，设置路径后立即把现有资源全量拷贝过去、之后每次上传自动增量同步，外部盘不可用不影响主存储；路径安全上要求绝对路径、必须已存在且是目录、不得是主存储本身/子目录/上级目录（防同步自我递归）。**② 资源导入导出**：ZIP 包含 manifest.json + files/ 目录，导出用 archiver 流式写出（大文件不撑爆内存），导入用 yauzl 流式解压并**重新分配全部 id**、保留 folder 层级与 latest/published 指针关系，同一个包可重复导入。验证：新增 `asset-mirror` 23/23 与 `verify-asset-storage` 32/32，后端 `npm test` 227/227、前端回归 233/233。**待 Codex 验收**。
>
> 注 3：2026-10-20 新增「资源管理」子系统（用户新增范围，独立于 TASK 编号体系）。数据模型严格按用户 spec 建 `asset_folders` / `assets` / `asset_versions` / `asset_tags` / `asset_tag_links` / `asset_operation_logs` 六张表。**三条核心不变量已用测试钉死**：① 版本独立不可变（追加版本不改既有版本文件）；② Latest 与 Published 完全独立（上传只动 latest，`publishAssetVersion()` 是唯一能移动 published 指针的入口）；③ 恢复历史版本 = 复制内容生成新版本（Latest=v7 恢复 v3 → 生成 v8，latest 只前进不后退，历史一个不少）。前端为三栏布局（导航/文件夹树 + List-Grid + 详情抽屉），预览走 PreviewManager + 8 个 Provider 架构（业务代码无 if(jpg) 分支），第三方依赖全部动态 import。**技术栈偏差已在实现中说明**：用户任务书假设为原生 HTML/CSS/JS，实际项目是 Vue 3 + Vite 6，按实际栈实现，未引入第二套框架。验证：后端 `npm test` 204/204、新增 `verify-assets` 30/30、前端回归 201/201。**待 Codex 验收**。
>
> 注 2：2026-10-20 的「知识库/首页文档卡片网格改造」（用户 2026-10-20 截图驱动）同属功能性延伸，不占用 TASK 编号。列表接口新增 `snippet` 字段并**停止回传 `content_md` 全文**（`SELECT d.*` → 显式字段列表 + 按 id 分批取正文生成摘要），属接口返回字段变更：前端列表页原本就不用正文（编辑页走详情接口），无兼容性影响。验证：后端 `npm test` 115/115、新增 `verify-cards` 18/18、回归 153/153。**待 Codex 验收**。

数据库方案已确定为 SQLite（2026-10-16，用户指定）；驱动 = better-sqlite3；迁移 = 手写 NNN_xxx.sql + `schema_migrations` 表；建表初版（001_init.sql）已实装；业务读写层（TASK-002 存储层 + TASK-003 HTTP 接口）已实现并自测通过。

## 3. 下一任务

**纪律说明（更新于 2026-10-19）**：TASK-002 / TASK-003 已实现并自测通过、TASK-004 前端框架已实现、TASK-005 本次实现并构建/联调通过，但 TASK-002/003/004/005 **仍待 Codex 正式验收**，不宣称验收通过。依用户 2026-10-19 多次 "继续" 指令，在自测通过基础上逐次推进了 TASK-003、TASK-005；阶段四（TASK-006/007/008）可在 TASK-005 之后启动，但 MVP 集成验收（TASK-010）前应补齐 TASK-002~005 的 Codex 验收与浏览器交互式验收。

**下一任务**：TASK-010（MVP 集成验收，阶段门槛）；TASK-009 余下的**备份脚本与恢复演练文档**。正式开工前建议先补齐 TASK-002~009 的 Codex 验收。

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
- 备份导出/导入（TASK-009）已实现（页面内按钮 + 快照接口），但**定时备份脚本与恢复演练文档尚未编写**，数据安全仍依赖手动操作。
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
| 备份依赖手动 | 数据丢失风险 | TASK-009 已提供页面内导出/导入按钮（快照格式可移植、导入幂等），仍缺定时备份脚本；自动化列入待决策 |
| Vue SFC 解析器限制 | `<script>` 块中含字面量 `</script>` 会让构建失败 | 已在脚手架文档与代码风格上规避；本任务已实测不含该字面量的完整构建 |
| API 尚未被前端消费 | TASK-003 接口未接入 UI，无法验证端到端真实路径 | 待 TASK-005 接入；接口层已用自动化测试 + curl 联调覆盖 |
| 单人推进 | 知识与进度集中 | 决策与状态全部文档化，CHANGELOG 追加留痕 |

## 6. 更新纪律

每完成一个任务：更新第 2 节状态、第 3 节下一任务、第 4 节追加验证证据，并在 [CHANGELOG](../CHANGELOG.md) 追加条目；禁止把计划写成实现，禁止无证据的“已通过”。
