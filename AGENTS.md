# AGENTS.md — 协作代理规则

本文件约束在本仓库工作的 AI 代理与人协作者。规则高于个人默认习惯；文档与代码冲突时，先更新文档再改代码。

## 通用规则

1. **语言**：文档、任务描述、提交说明使用中文；特性编号 `F-xx-xxx` 与任务编号 `TASK-xxx` 一经发布保持稳定，不得重编号或复用已删除编号。
2. **先读后写**：动手前先读 [README](README.md)、[docs/FUNCTIONAL_SPEC.md](docs/FUNCTIONAL_SPEC.md)、[docs/DEVELOPMENT_PLAN.md](docs/DEVELOPMENT_PLAN.md)、[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) 与 [docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md)。
3. **状态唯一来源**：进度与完成情况只记录在 docs/PROJECT_STATUS.md；README 等其他文档只链接引用，不得复制进度，避免双源漂移。
4. **每完成一个 TASK-xxx**：必须同步更新 PROJECT_STATUS.md（完成/未开始、验证证据、下一任务），并在 [CHANGELOG.md](CHANGELOG.md) 追加条目。
5. **禁止把计划当实现**：未经对应验证的代码不得描述为“已完成/已实现/已通过测试”；禁止虚构运行、测试、部署成功。
6. **不虚构命令与结果**：写入文档的命令必须是实际验证过的；尚未存在的功能不得给出使用说明或启动命令。
7. **验证证据**：更新状态时写明证据（命令输出摘要、检查步骤等）；无法验证的明确写“未验证”。
8. **范围纪律**：MVP 完成门槛只包含 DEVELOPMENT_PLAN 中 TASK-001~TASK-010；延期特性（F-COL-001 实时共同编辑、F-SEC-001 账号与权限，对应 TASK-D01/D02）不得计入 MVP 完成。
9. **安全边界**：任何文档或代码中不得宣称系统可无认证安全用于公网；部署假设始终是受控内网/本机。
10. **数据边界**：禁止把浏览器 localStorage 当作团队共享数据库；团队数据一律服务端持久化。

11. **WorkBuddy 调用报告**：每次模型任务结束，报告实际使用模型、执行结果与消耗积分。积分未返回时写“积分未提供，无法确认”；不能用 Token 或美元费用当作积分，不把管理查询重复算作模型请求。

## 前端约定

本项目前端为 Vue 3 + Vite。以下为硬约束，违反即为缺陷，不是风格偏好。

1. **浮层必须 Teleport 到 body**：任何 `position: fixed` 的浮层（弹窗、下拉菜单、浮层提示）必须用 `<Teleport to="body">` 挂到 body 下。原因是 `.glass-panel` 上的 `backdrop-filter` 会创建包含块，使后代 fixed 改为相对该容器而非视口定位（详见 [styles/glass.css](frontend/src/styles/glass.css) 顶部说明）。验收见 `frontend/verify-overlay-position.mjs`。
2. **颜色一律走 CSS 变量**：组件内禁止硬编码色值（含 rgba/hex）。主题差异只在 `theme.css` 声明，量值（字号/圆角/间距/动效时长）只在 `tokens.css` 声明；样式文件按 `tokens → theme → glass → layout → components → 业务样式` 单向依赖，后一层只许引用前一层变量。
3. **深色背景不用纯黑**：大面积底色用 `#090f18` 一类深蓝灰，保证玻璃高光与模糊有可感知层次。
4. **动效时长**：微交互 120~180ms，主题切换 200~300ms；禁止弹跳、大幅缩放、强发光。
5. **图标统一 Lucide 风格**：内联 SVG，`stroke-width` 1.7~1.9；禁止 Emoji 图标、3D 图标、混用多套图标库。
6. **backdrop-filter 不层层嵌套**：只允许大型容器（`.glass-panel` / `.overlay` / `.dialog`）使用；列表项、按钮、输入框一律用半透明背景色。
7. **响应式逐级折叠**，不整体缩放页面；`.app-layout` 保持 `min-width: 1280px`（窄屏横向滚动而非缩放）。
8. **浮层定位先测量后落位**：菜单类浮层应先渲染、测量真实尺寸再夹取到视口内，不硬编码宽度；菜单用 `ref` 取元素而非 `querySelector`（同类浮层会取错）。
9. **破坏性操作需二次确认**：永久删除、清空回收站等不可逆操作必须经用户显式确认（`?confirm=1` 或前端确认弹窗），且失败原因要写进操作日志，不得静默吞掉。
10. **验收脚本自造数据必须按特征全量回收**：清理时按名称特征（如 `/^AM\d{4,}/`）搜索并删除，**不得只硬编码本轮的 id** —— 脚本被中断时 exit 处理器里的异步请求不会跑完，只删本轮 id 会留下垃圾数据污染演示库。
11. **清理测试数据必须扫「正常 + 回收站」两个范围**：文档与资源都是软删，只调 `DELETE` / `batch-delete` 只会把测试数据移进回收站 —— 跑几次回归就堆一批垃圾，而且**一旦沉进回收站就再也匹配不到**（列表默认不含回收站），会永久堆积。统一用 `frontend/verify-cleanup.mjs`：
    - 文档：`purgeTestDocuments(apiBase, /标题特征/)`
    - 资源：`purgeTestAssets(apiBase, /名称特征/)`
    两者内部都完成了「软删 → 永久删除」两步，并同时扫两个范围。新增会造数据的验收脚本必须走这个模块。
12. **验收脚本不得真的执行「安装更新」**：`POST /api/update/apply` 会替换程序文件并重启服务，跑一次测试环境就变样了，还可能把开发目录换成发布包内容。`verify-update.mjs` 只验证到「界面把状态讲清楚」，换文件与回滚由 `backend/src/updater.test.js` 与隔离沙箱里的 `apply.cmd` 手工验证覆盖。测试更新相关功能时，更新源指向 `os.tmpdir()` 下的临时目录，结束务必清空配置（`PUT /api/update/source` 传空串）。

### 验收脚本索引

前端 `frontend/verify-*.mjs`（真实浏览器 + CDP 自动化），改动对应功能后必须重跑：

| 脚本 | 覆盖 | 对应约定 |
|---|---|---|
| `verify-overlay-position.mjs` | 浮层定位、遮罩铺满视口、弹窗居中 | 1、8 |
| `verify-full-backup.mjs` | 全量备份：菜单明示范围、包结构完整、非法包被拒 | 9 |
| `verify-search.mjs` | 全文检索：中文子串命中、英文词边界、空状态、清除恢复 | 10 |
| `verify-release-runtime.mjs` | 发布包运行时：内置 Node、ABI 自检、启动脚本契约 | — |
| `verify-asset-reference.mjs` | 文档引用资源：插入、落库、渲染、失效降级 | — |
| `verify-document-trash.mjs` | 文档回收站：软删、恢复、永久删除、二次确认、不误伤正常文档 | 9、10 |
| `verify-asset-collections.mjs` | 资源集合：列表、详情、移除不删资源、删集合不删资源 | 9、10 |
| `verify-update.mjs` | 自动更新：未配置/已最新/有新版/清单损坏四种状态，不执行安装 | 9、11 |
| `verify-android-wireless.mjs` | 安卓调试：双栏与独立滚动、帮助/ADB 设置弹窗、六项常用命令、当前用户 HOME 选择/确认/复查/恢复/失效清理、自定义命令增改删/持久化/确认/版本冲突、实时 Logcat、单应用选择/状态/子进程隔离/重启跟随、屏幕单次/连续刷新/放大/取消/图片释放、二维码及六位码配对、单设备断开、错误恢复和明暗下拉对比度；使用离线 ADB 执行器 | 1、2、9 |
| `verify-qr-share.mjs` | 二维码内容、颜色走 CSS 变量、主题切换 | 2、4 |
| `verify-batch-mode.mjs` | 批量模式开关、菜单落在视口内 | 1、8 |
| `verify-asset-preview.mjs` | 预览管线、缩略图、失败原因可见 | — |
| `verify-assets.mjs` | 资源列表、筛选排序、版本历史 | 9、10 |
| `verify-asset-storage.mjs` | 存储路径、导入导出 | — |
| `verify-vditor.mjs` / `verify-help.mjs` / `verify-hint.mjs` | 编辑器、帮助、悬停提示 | 4 |
| `verify-cards.mjs` | 文档卡片布局、响应式降列 | 7 |
| `ui-verify.mjs` | 既有页面通用断言 | 3、5 |
| `verify-batch-delete.mjs` | 知识库批量删除 | 9 |


## 安卓调试边界（F-ADB-001）

- ADB 仅在服务器执行，模块 API 只允许回环客户端和本机 Host；保留浏览器来源检查、JSON 和专用请求头要求，不信任代理转发头。
- 进程调用使用参数数组、禁用本机 Shell、隐藏窗口、输出限制、超时与取消；自定义命令限 TASK-026 的已保存 ID、版本及确认执行，不增加临时自由执行接口或全局断开。
- 六位码配对只使用短期缓存的 mDNS 配对服务；二维码配对只匹配当前短期会话生成的随机服务名。六位码与二维码随机口令仅经 stdin 传给 ADB，禁止写入进程参数、文件或日志。二维码内容仅在会话创建响应中返回当前本机页面，状态接口不得回传口令。
- 文件夹扫描必须异步、有深度/目录/条目/结果/时间上限，不跟随子目录链接；多个 ADB 候选由用户选择，校验版本成功后才能保存。兼容既有可执行文件路径和 `ADB_PATH`，不需要 SQLite 或配置结构迁移。
- 扫码会话两分钟有效，可在 ADB 忙碌时取消；取消、到期、配置变化和页面离开后清理口令与二维码。只能自动连接刚配对手机的连接服务；出现同地址多设备歧义时要求手动选择。扫码状态逻辑位于 `android-qr.js`，文件夹搜索位于 `android-adb-search.js`，公共解析位于 `android-adb-protocol.js`。
- ADB 路径持久化到 `data/android-adb.json`（`ADB_PATH` 优先）；自定义命令单独保存到机器配置 `data/android-commands.json`，不放入团队备份。设备、发现服务和配对码均为瞬时状态。
- 断开必须确认明确的单台无线设备，连接和断开后刷新列表，并区分操作失败与操作成功后刷新失败。
- ADB 配置由 `AndroidAdbSettings.vue` 负责，经 `AndroidSettingsDialog.vue` 在调试页与设置页复用；操作说明由 `AndroidHelp.vue` 点击后弹出。弹窗必须 Teleport 到 body，支持键盘关闭与焦点恢复。调试页左侧为设备连接和列表，右侧为命令、屏幕与日志，两栏独立滚动。常用命令位于 `AndroidCommands.vue`，内置仅保留锁定程序、恢复桌面、IP、设备信息、内存与 CPU 六项；接受服务端内置或保存的自定义命令 ID，HOME 命令仅额外接受经过校验的 `component` 与 `userId`，其他命令拒绝这两项及任意附加参数。执行前重新验证目标为 `device`，必须插入 `-s <serial>`。输出不持久化。
- `android-home.js` 通过 `am get-current-user`、限定 HOME Intent 的 `cmd package query-activities/resolve-activity` 读取当前用户、候选与默认值；组件严格校验、规范化并限量。设置必须布尔确认，复核当前用户及实际候选，再执行 `cmd package set-home-activity --user <用户> <组件>`，检查成功输出并复查默认包，失败不能冒称成功。总时限 30 秒，子命令各有输出/超时上限和取消；不猜测普通应用的启动页，不自动启动应用，也不实现禁退锁定。`AndroidHomeSelector.vue` 管理搜索与主动选择，换设备/命令/配置或离页清理；候选、用户与结果只在内存。IP 查询全部接口 IPv4；内存与 CPU 是 dumpsys 快照，不新增后台采集。
- `android-custom-commands.js` 校验单条参数并解析引号，拒绝 `adb` 前缀、全局选项、连接管理和 Shell 管道/重定向/拼接；远端 `shell` 参数须按字面量转义，不能仅依赖本机 `shell:false`。自定义执行总是要求布尔确认和当前版本；修改/删除也核对版本，内置不可修改。命令库原子保存，损坏时拒绝覆盖，原文与结果不记操作日志。编辑弹窗失败保留草稿，不触发执行。
- `android-logcat.js` 只使用固定 `-s <serial> logcat -v threadtime -T 100` 参数读取在线设备。服务端最多保留一个短期会话，缓存最多 2000 条或 1 MiB，单行最多 4096 字符，未完成单行缓冲超过 65536 字符时停止；每次轮询最多 300 条，15 秒无心跳终止进程。日志正文只在内存，不写配置、数据库或操作日志。停止不占用普通命令锁，切换设备、离页、配置变化、对应设备断开/重启及服务器退出必须结束采集；不提供清空手机缓冲区的操作。`AndroidLogcat.vue` 负责过滤、自动滚动和最多 2000 条的页面缓存。
- 安卓原生下拉统一使用 `android.css` 的 `.adb-select`，底色不透明，选项/选中/禁用态按主题配色。主题切换时文字与底色同步更新，避免全局输入框背景动画造成瞬时低对比。
- `android-apps.js` 只读查询明确在线设备上的包名、安装路径与进程，包名必须严格校验，参数固定为 `pm list packages`、`pm path <包名>`、`ps -A -w -o PID,NAME`，查询有超时和输出上限；使用宽输出避免长包名截断。列表最多 2000 个包名；运行状态按精确包名或 `包名:` 子进程名匹配，不能按任意子串猜测 PID。应用日志只把匹配 PID 的内容加入缓存并返回浏览器；心跳最多每两秒刷新一次 PID 集合，不另起永久扫描定时器，停止时取消在途查询。所有状态只在内存，不自动启动/停止手机应用，不把进程存在等同于前台或健康状态；短暂进程/特殊进程名/系统代写日志的限制必须在帮助中说明。
- `android-screen.js` 只读在线且已授权的明确设备，以固定 `-s <serial> exec-out screencap -p` 参数读取原始二进制，禁止复用 UTF-8 文本 runner。设备检查与截图总时限 12 秒，图片输出最多 16 MiB、错误输出最多 4096 字节，验证 PNG 签名、块边界与 CRC、IHDR/IDAT/IEND、单边 16384 和总像素 32 Mi 上限。全服务最多一个在途截图，不占普通命令锁；请求取消、配置变化、对应设备断开/重启和服务退出时取消。API 复用本机保护，返回不缓存的 PNG；图片不写磁盘、数据库或日志。
- `AndroidScreenPreview.vue` 默认不读取，必须选择设备；连续刷新在上次读取完成后等待所选间隔，不重叠请求。停止保留最后画面，清空会停止并撤销图片 URL；替换、取消解码、切换设备、设备消失、配置变化和卸载时释放 Blob URL。页面进入后台时停止并保留最后画面，离页清空；放大弹窗必须 Teleport 到 body 并支持 Escape 与焦点恢复。帮助须说明截图刷新速度及受保护内容的显示限制。
- 修改后运行 `backend` 的 `npm test`（包含 `android-adb.test.js`、`android-adb-search.test.js`、`android-qr.test.js`、`android-adb-commands.test.js`、`android-home.test.js`、`android-custom-commands.test.js`、`android-logcat.test.js`、`android-apps.test.js` 和 `android-screen.test.js`）、前端构建和 `node frontend/verify-android-wireless.mjs`。浏览器验收使用临时配置与离线执行器，结束清理临时目录；不得把模拟验证宣称为真实手机验证。

## Unity 局域网日志边界（F-ULOG-001）

- 入口 `UnityLogs.vue` / `/tools/unity-logs`；`unity-log-client.js` 只请求本机后端。`unity-log-view.js` 解析与筛选整条日志，Vue 插值展示正文；预览限 256 KiB、显示限 1000 条。CSS 延续 tokens/theme 约束。
- `unity-log-discovery.js` 按本机私有 IPv4 掩码生成有界候选，仅探测 TCP 日志端口和固定发现协议；默认 1024 地址、64 并发、25 秒总限，报告实际检查范围。指定 IP 也必须属于本机真实私网网段；不能接收自由 URL 或探测公网。
- `unity-log-http.js` 固定路径、严格文件名校验，不跟随重定向；缓冲与流式读取都必须有完整请求超时、取消和响应大小限制。流建立到消费端之间的错误必须被捕获，避免未处理事件或挂起。
- `unity-logs.js` 只在内存缓存发现结果与短期读取会话，最多八个会话，票据不回传浏览器、不记日志、不落盘；重连核对固定编号及 App ID。`unity-log-api.js` 要求回环客户端、本机 Host/Origin、JSON 与专用头，不信任转发头。文件只读，下载交给浏览器，不自动写团队数据库或备份。
- 取消、切换设备、离页及服务器关闭必须取消在途请求；连接已建立但响应未交付时回收会话。页面后台暂停读取与连接。失败保留上次成功的预览，不能仍标记为正常读取。
- Unity 改动限定 `Assets/Test/Log`，不得改 AnchorFrame 或原 GameLogic 日志模块；不得手改场景/预制体 YAML。设备新增发现协议位于 AOT，需完整重新打包。真实 Android/iPad 权限、网络和后台恢复需硬件单独验证，不能把本机 C# 协议联调当作真机测试。
- 改动后运行完整 `backend` 的 `npm test`（包含 `unity-log-discovery.test.js`、`unity-logs.test.js`、`unity-log-api.test.js`）及前端构建；用隔离 C# 服务提供合成日志，通过浏览器验证搜索、历史、筛选/复制/下载、错误恢复、取消与离页。不得读写真实团队数据库或将合成日志混入设备数据；验证后关闭临时服务。

## 变更流程

- 修改规格：同步更新 FUNCTIONAL_SPEC 的特性条目与覆盖矩阵，保持特性与任务双向覆盖。
- 修改计划：保持依赖无环、阶段门槛可测；新增任务使用新的 TASK-xxx 编号。
- 修改架构：更新待决策清单，标记决策日期与结论；选型不依赖“最新版本”事实。

## 禁止事项

- 未经用户明确授权执行 git push 等远端操作或发布。
- 在 USER_GUIDE 中添加未经验证的启动命令。
- 删除或改写 CHANGELOG 历史条目（只允许追加）。
- 在空状态或指南中展示伪造的运行结果、模拟成功数据。
