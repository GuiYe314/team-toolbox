# 架构说明（ARCHITECTURE）

## Unity 设备日志模块补充（2026-11-05）

- TASK-025 / F-ULOG-001：`/tools/unity-logs` → 本机专用 `/api/unity-logs/*` → 同局域网 Unity 的 TCP 17523 只读日志服务；不依赖 ADB、不改 SQLite。
- `unity-log-discovery.js` 从本机私有 IPv4 与掩码生成有界搜索范围，只探测专用 HTTP 发现协议。设备编号跨 IP 保持稳定，票据绑定来源 IP、闲置两分钟到期；票据只存后端内存，不给浏览器、不落盘。
- `unity-logs.js` 管理发现结果及最多八个短期读取会话，固定日志路径、响应大小、超时、取消和下载流限制；`unity-log-api.js` 检查本机来源/Host/浏览器上下文及专用请求头。拒绝自由 URL、公网探测和重定向。
- Unity 修改仅在 `Assets/Test/Log`：默认自动开放局域网读取，手动关闭保留；后台关闭、前台按原开启状态恢复。浏览器直连的访问码方式保留，工具箱通过发现票据自动读取。此修改在 AOT 程序集，必须重新打 APK/iOS 包。
- 同 Wi-Fi 不保证设备互通：AP 隔离、iOS 本地网络权限、应用后台或不同 VLAN 需明确排查；大网段扫描截断与超时必须反馈真实覆盖范围。

## 安卓无线调试模块补充（2026-11-05）

- TASK-019 / F-ADB-001：前端 `/tools/android-wireless` → `/api/android/*` → 独立 ADB 服务，沿用 Vue 与 Express，不依赖浏览器直接访问 USB 或运行本机命令。
- ADB 安装于服务器；模块仅允许服务器本机通过 localhost/回环地址访问，写请求检查 JSON、自定义请求头和浏览器同源上下文。常规知识库/资源库的受控内网访问边界保持原约定。
- 服务使用内置参数列表或已保存自定义命令的校验结果，以 `spawn`、`shell: false`、隐藏窗口、限量捕获、超时和取消执行。执行接口以命令 ID 解析参数；HOME 设置仅增加严格校验的组件与当前用户字段，其他命令拒绝这两个字段。自定义命令必须确认目标、内容和版本，不提供临时自由执行或全局断开接口。
- 配对只接受短期缓存的 mDNS 配对服务；六位配对码走 stdin，并在返回结果中脱敏。操作日志仅记录动作、成功/失败与错误码。
- 服务器本地 ADB 路径以临时文件加替换保存至 `data/android-adb.json`，环境变量 `ADB_PATH` 优先；属于机器配置，不加入团队文档备份。发现结果、设备与配对码不持久化，无 SQLite 迁移。
- TASK-020：文件夹搜索采用异步、有深度/目录/条目/时间上限的扫描，不跟随目录链接，返回候选路径后复用版本校验与配置。二维码使用 [Android 官方 ADB Wi-Fi 协议](https://android.googlesource.com/platform/packages/modules/adb/+/HEAD/docs/dev/adb_wifi.md) 的 `WIFI:T:ADB` 内容；独立短期会话在内存中保存随机服务名和口令，页面轮询触发有界的 mDNS/配对/连接操作，不启动永久后台扫描。只匹配本会话的配对广播及同一手机的连接服务；口令仅经 stdin 传给 ADB，状态接口不回传凭据。取消、到期、配置变化和页面离开时终止会话并清理口令。
- TASK-021：帮助采用 Teleport 弹窗；ADB 配置由设置页的独立组件负责，调试页仅读取配置。`android-adb-commands.js` 提供不可变的命令目录与执行校验，经现有独占锁、进程超时及本机 API 执行；客户端只提交命令 ID、设备序列号及确认标记，不能注入参数。每次执行重新检查设备在线，重启须确认，输出为内存态。
- TASK-022：`AndroidSettingsDialog.vue` 在调试页和设置页复用 ADB 配置弹窗，Teleport 到 body。调试页采用设备区与命令/日志区双栏。`android-logcat.js` 单独管理指定设备的 Logcat 子进程、UTF-8 行解析、有界环形缓存、增量游标与心跳过期，不占用普通命令的长期独占锁；日志会话停止不排队，配置变更/对应设备断开/重启会主动停止。浏览器停止、离页使用 keepalive 撤销，断网由闲置超时清理；日志内容不写入数据库、配置或服务器操作日志。
- TASK-023：`android-apps.js` 使用明确设备的安装包、路径与进程查询读取包名和运行状态。`AndroidAppSelector.vue` 管理只在当前页生效的包名搜索、选择及状态快照。应用模式复用一个 Logcat 进程，在服务端按精确主进程名或 `包名:` 前缀获得的 PID 集合筛选，其他进程原文不进入缓存或 API；心跳轮询最多每两秒刷新一次 PID 集合，停止/切换会取消在途查询。保留设备日志模式，不新增应用控制或性能分析能力。
- 进程查询固定为 `ps -A -w -o PID,NAME`：[Android Toybox 字段说明](https://android.git.googlesource.com/platform/external/toybox/+/d4ea1b3b845f13f6a3c354266b97abc4ada6b1c8/generated/help.h) 中 `NAME` 为 argv[0]，`-w` 禁止截断宽字段，避免长包名及子进程名被裁切。
- TASK-024：`android-screen.js` 以明确设备和固定 `exec-out screencap -p` 读取二进制，独立限制一个在途截图、12 秒总时限、16 MiB 输出、PNG 块完整性和 32 Mi 像素。`/api/android/screen` 复用本机来源与请求头保护，以不缓存的 PNG 响应返回，不落盘；配置/目标连接变化会取消截图。`AndroidScreenPreview.vue` 用 Blob URL 展示当前图，替换时撤销旧 URL，连续刷新使用请求完成后的定时器，停止/设备变化/配置变化/离页/后台时取消，放大视图 Teleport 到 body。
- TASK-026：`android-custom-commands.js` 负责单条 ADB 参数解析、限制、远端字面量转义与机器命令库；`data/android-commands.json` 版本 1 通过临时文件替换保存，最多 100 条，损坏时明确报错且拒绝覆盖。自定义命令与内置命令合并展示，执行仍只提交服务端保存的 ID，并携带版本和强制确认；更新/删除也核对版本。`AndroidCommandEditor.vue` 通过 body Teleport 弹窗编辑，保留失败草稿；常用命令组件负责选择、确认和结果。命令原文不进操作日志，不进入团队备份，无 SQLite 迁移。
- TASK-027：内置命令精简为默认桌面锁定/恢复、IP、设备信息及内存/CPU 快照。`android-home.js` 查询当前用户及 HOME 组件，设置时重新校验，成功后复查默认包；`AndroidHomeSelector.vue` 管理设备相关候选与主动选择，设备/命令/配置变化清空。只设置默认桌面，不实现禁退或 Device Owner。依据 [AOSP set-home-activity 实现](https://android.googlesource.com/platform/frameworks/base/+/dec5b1985f6930856c6fde0be2e9ef47623c7306/services/core/java/com/android/server/pm/PackageManagerShellCommand.java)，使用显式用户和组件，兼容以包名决定 HOME 角色的系统；实际支持范围由设备返回，不猜测普通启动 Activity。

- 基线日期：2026-10-16。本文描述目标架构与约束；进度以 [PROJECT_STATUS](PROJECT_STATUS.md) 为唯一来源。其中文档页面树已在迁移 002（`documents.parent_id` 自引用 + 级联删除）落地，其余仍为规划。

## 1. 总体形态

单体网页应用：浏览器前端 + 单进程服务端 + 服务端 SQLite 数据库。第一版不依赖任何外部服务（无外部数据库服务、无消息队列）。规模假设：内部小团队（约 <20 人），并发编辑同一文档概率低，冲突由乐观版本兜底。

规模上限、长度限制、默认分页、标签 AND 语义及部署形态属于本次规划建议，尚未经真实负载验证；技术栈与目标运行环境在 TASK-001 中确认。乐观版本机制不能替代未来 CRDT/OT 的操作模型设计。

## 2. 模块划分

| 模块 | 职责 | 备注 |
|---|---|---|
| 前端 UI 模块 | 首页（最近更新 + 工具卡片）、文档列表/详情/编辑页、空状态组件 | 不含任何具体小工具 |
| 前端数据访问模块 | API 客户端、错误与 409 冲突处理、会话内草稿保留 | 草稿仅会话内状态，不是共享存储 |
| 服务端 API 模块 | 文档/分类/标签/搜索接口、输入校验、统一错误码 | |
| 领域与存储模块 | 数据实体、乐观版本号、持久化读写 | SQLite 已确定；驱动与迁移工具待 TASK-001 选定 |
| 备份模块 | 导出/恢复工具（脚本或命令） | 交付于 TASK-009 |

禁止事项：任何模块不得以 localStorage 作为团队共享数据源（只允许会话级 UI 状态，如草稿暂存）。

## 3. 数据实体（概念模型）

- **Document**：id（服务端生成）、title、content_md、category_id（可空）、parent_id（可空，自引用外键；NULL=顶层页面，构成页面树；删除父页面级联删除其子树）、version（整数，乐观锁）、created_at、updated_at。
- **Category**：id、name（唯一，1–30 字符）。
- **Tag**：id、name（唯一，规范化：去空白、英文小写）。
- **DocumentTag**：document_id + tag_id（多对多关联）。
- **规则**：单文档标签 ≤10；分类 ≤50 且不嵌套；文档支持通过 `parent_id` 构成任意深度的页面树（删除父页面级联删除子树）；删除分类 → 其文档 category_id 置空；删除文档 → 同步删除其标签关联；updated_at 由保存驱动，供首页排序与搜索排序使用。

## 4. 保存冲突与乐观版本

- 每次保存请求携带读取时的 version；服务端比对：一致 → 写入并 version+1、更新 updated_at；不一致 → 返回 409 及服务端当前内容。
- 前端收到 409 后提示并提供两个选项：【加载最新（丢弃本地修改）】与【基于最新覆盖保存（需再次确认）】。MVP 不做自动合并。选择覆盖时，使用刚获取的最新 version 重新进行条件写入；若期间又有更新，仍返回 409，禁止无条件覆盖。选择加载最新前需二次确认丢弃本地草稿。
- 设计意图：版本号单调递增（仅用于冲突检测，不包含历史版本存档），为未来协同扩展保留基础，但 MVP 只承诺“检测 + 人工决策”，不承诺无损合并。

## 5. 未来协同扩展（方向性说明，不构成承诺）

实时共同编辑（F-COL-001，延期）可在版本链之上引入：服务端广播或轮询通道，配合操作转换或 CRDT（届时经 TASK-D01 预研选定）。MVP 数据模型（version、updated_at）不阻碍该扩展。此节仅为方向记录，不代表已设计或已实现。

## 6. 备份与恢复

- 备份 = 将全部数据导出为与存储引擎无关的格式（JSON 或 Markdown+元数据），写入部署目录外的备份位置或 backups/（已被 .gitignore 排除）。
- 恢复 = 按文档步骤导入备份重建数据；恢复前必须确认覆盖，并先备份当前数据；先在临时位置校验备份格式、schema_version、关联完整性，再在事务或原子切换中恢复，失败保留原数据，不能先清空生产库。文档删除（F-KB-003）的找回也走备份副本，MVP 无回收站。
- 频率：MVP 为手动触发（重要变更后导出）；自动化备份待决策。

## 7. 内部访问边界（安全）

- 第一版无认证、无授权。**唯一边界是网络边界**：服务仅绑定内网/本机地址，部署说明必须声明“不得暴露公网”。
- 反向代理/TLS 属于可选部署方式，不视为安全边界（无认证时公网暴露即数据公开可读写）。
- 输入不信任：服务端校验长度与结构；Markdown 渲染走安全渲染（默认转义 HTML、白名单语法），防存储型 XSS。
- 在 F-SEC-001（延期）实现前，任何“可无认证安全用于公网”的表述都违反本边界，禁止出现在文档或宣传中。

## 8. 部署假设

- 单机、单进程、单存储；操作系统不限（按 TASK-001 决策记录为准）。
- 绑定地址/端口、数据目录、备份目录经环境变量配置；env.example 提供样例，真实 .env 不入库（.gitignore 排除）。
- 部署环境为受控内网或本机；不存在公网部署假设。

## 9. 待决策清单（TASK-001 的输入与输出）

> 决策日期：2026-10-16。MVP 阶段一已就以下选项做出决策。下一任务（TASK-002 起）将依据本表落地。

| 决策项 | 候选方向 | 状态 | 决策与理由 |
|---|---|---|---|
| 服务端语言/运行时 | Node.js / Python / Go / Java | 已决策：Node.js | 单一技术栈减少部署组件；社区成熟；与前端工具链共用。绑定 LTS 行：v22.x（Active LTS，代号 Jod）。本机验证版本：v22.22.2（npm 10.9.7）。 |
| 服务端框架 | Express / Fastify / Koa / NestJS | 已决策：Express 5 | 学习曲线平缓，团队接手成本低；Express 5 已发布稳定版（5.3.0，2026 年仍在维护），需 Node ≥ 18，本项目用 v22 满足。 |
| 持久化引擎 | SQLite | 已决策：用户于 2026-10-16 指定 | 见本文件第 10 节。 |
| SQLite 驱动 | better-sqlite3 / node:sqlite（内置）/ sqlite3 / Prisma | 已决策：better-sqlite3 | 同步 API 配合 Express 路由简洁高效；官方维护 prebuilt 二进制，部署免编译；事务支持完整。 |
| 迁移工具 | 手写迁移脚本 / umzug / Drizzle Kit / dbmate | 已决策：手写迁移脚本（不引入额外依赖） | 扫描 `migrations/NNN_xxx.sql` 文件，配合 `schema_migrations` 表记录版本；事务包裹保证原子性。理由：MVP 仅 1 套 schema，手写更可读、可排错；后续复杂可再迁移至 umzug/Drizzle。 |
| 前端框架 | Vue / React / Svelte / 纯原生 | 已决策：Vue 3（Options API + `<script>` 普通写法） | 上手快、运行时小、与 Vite 模板默认集成；不引入 TypeScript 以保持构建链最小。 |
| 前端构建工具 | Vite / webpack / Parcel | 已决策：Vite 6 | Vite v6.4.4 当前稳定；Node 要求 v20.19+ / v22.12+，本项目 v22.22.2 满足。 |
| 路由 | Vue Router / 自写 hash 路由 | 已决策：Vue Router 4 | MVP 阶段依赖相对薄；保留 path-based 路由便于受控内网访问。 |
| Markdown 编辑器形态 | 分屏预览 / 所见即所得 / 纯 textarea | 已决策：分屏预览（textarea + 渲染结果并列） | 风险低，所见即所得对未知输入可能丢失或破坏源码；textarea 更接近"原文存储"原则。实现置于阶段三 TASK-005。 |
| Markdown 解析 | marked / markdown-it / remark | 已决策：marked | 速度快、API 简洁；v14 同步 API 默认禁用内联 HTML，配合 sanitize-html 走白名单净化。 |
| Markdown 安全渲染方案 | marked + sanitize-html / marked + DOMPurify+jsdom / xss | 已决策：marked + sanitize-html | sanitize-html 基于 htmlparser2，无 DOM 依赖；服务端无需引入 jsdom（避免 DOMPurify README 提示的 happy-dom/jsdom 历史 CVE 风险）；白名单 + 强制 `rel="noopener noreferrer"`。 |
| 搜索实现 | SQL LIKE / SQLite FTS5 / 外部索引 | 已决策：MVP 用 SQL LIKE，参数化查询；标题/正文均按 `LOWER(...) LIKE LOWER(?)`；FTS5 待 TASK-007 评估 | 阶段一/TASK-007 前不引入 FTS 复杂度；MVP 数据量小，参数化 LIKE 足够。FTS5 在中文分词上需额外决策，记入待决策。 |
| 备份自动化 | 手动 / 定时任务 | 待决策：MVP 默认手动触发（TASK-009 实现）；自动化列入后续 | 详见 [DEVELOPMENT_PLAN](DEVELOPMENT_PLAN.md) 阶段五。 |
| HTTP 绑定地址 | 127.0.0.1 / 0.0.0.0 / 内网 IP | 已决策：默认 127.0.0.1，可由 `HOST` 环境变量改为内网 IP | 与本文件第 7 节"内部访问边界"一致；默认值拒绝公网。 |

补充说明：

- 选型严格按"决策日可用的稳定版本"选取，不绑定"最新版本"事实；版本号在实施时通过 `npm view` 复核。
- 上述决策不构成对未来协同（F-COL-001）/账号权限（F-SEC-001）阶段栈的承诺；届时重审。
- 脚手架目录约定：
  - `backend/` —— Node.js 后端（Express 5 + better-sqlite3 + marked + sanitize-html）。
  - `frontend/` —— Vue 3 + Vite 前端；`VITE_API_BASE` 默认 `/api`，Vite dev server 代理到后端 `http://127.0.0.1:3000`。
  - `data/team-toolbox.sqlite3` —— 数据库文件，默认相对仓库根；`backups/` —— 备份输出目录；均被 `.gitignore` 排除。

## 10. SQLite 数据库实施约定

- 决策来源：用户于 2026-10-16 明确指定 SQLite。单机部署先采用服务端数据库文件，便于内部项目部署与维护；不再把 JSON 文件列为业务主存储候选。此处为设计约定；SQLite 数据库已按迁移 001_init + 002_page_tree 落地（含文档页面树）。
- 建议默认路径：`data/team-toolbox.sqlite3`，由服务端配置覆盖；路径不是当前已存在文件。浏览器只能通过 API 访问，数据库目录不能作为静态资源暴露。
- 表：`documents`、`categories`、`tags`、`document_tags`；使用迁移脚本维护结构与 schema 版本（已落地 001_init + 002_page_tree）。`documents` 含 `parent_id` 自引用列，支持页面树；祖先/后代查询用递归 CTE（`WITH RECURSIVE`），移动页面时做防环校验（不可移到自身或后代之下）。分类删除解除归属，文档删除清理关联；名称唯一性、关联完整性与事务边界纳入验证。
- 初始化：TASK-001 选定兼容运行环境的 SQLite 驱动与迁移方式；TASK-002 实现连接、建表迁移、参数化查询、事务及错误处理，落实外键约束配置。
- 保存：用文档 ID 与读取时的 version 做原子条件更新，受影响行数判定版本冲突；文档与标签关联在同一事务更新。忙锁或写入失败应有明确错误，不得误报保存成功；重试不得造成重复新建。具体超时与重试上限在实现时记录。
- 索引：评估文档更新时间、分类、规范化标签名称与关联表的索引。中文搜索匹配规则已在 TASK-007 决策落地——采用参数化 `LIKE '%kw%'` 子串匹配（契合中文无词边界），关键词中的 `%`/`_`/`\` 通配符统一转义为字面量（配合 `ESCAPE '\'`）以防意外通配与注入；未引入 FTS5。若未来需要分词/相关度排序，再评估 FTS5 + 中文分词器方案。
- 备份：TASK-009 保留独立于引擎的逻辑导出与恢复；若增加数据库文件备份，必须采用经过验证的一致性备份流程，不直接复制正在写入的主文件当作完整备份。
- 版本控制：结构迁移与测试样例可提交；真实数据库、日志与备份不提交 GitHub。SQLite 日志/辅助文件同样忽略。
- 验收：空库初始化、迁移失败处理、重启读取、事务回滚、外键关联、并发版本冲突、不可写目录/忙锁反馈和隔离数据恢复均需要实测。增加用户规模或部署实例前重新评估数据库方案。
