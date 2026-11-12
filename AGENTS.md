# 设备调试工具协作约定

本分支维护 TASK-038 / F-DEV-001、TASK-039 / F-ADB-002、TASK-040 / F-ADB-003 及已有 F-ADB-001、F-ULOG-001。先读 README、docs/FUNCTIONAL_SPEC、DEVELOPMENT_PLAN、ARCHITECTURE、PROJECT_STATUS，再读相关源码和测试。中文提示/文档，状态只进PROJECT_STATUS，功能变更同步规格/架构/指南/CHANGELOG；不改写CHANGELOG历史。

- 只保留安卓与Unity日志，两模块固定API/参数/确认/取消/资源限制沿用下述原有边界。不得加回数据库、其他工具或主线更新器。
- 分支 codex/device-debugger；正式标签 device-debugger-v<版本>，独立安装ID及目录；发布必须指定非latest，保持完整工具箱latest和manifest。禁止提交运行数据/Key/Token/.env/node_modules/build/release。
- 默认生产3100/开发5174；Windows启动器默认Lan，可/local；直接Node默认Local。同源及真实网段保护保留，不能信任转发头或放宽防火墙。
- 每次相关改动执行backend npm test、frontend npm run build；运行 frontend/verify-android-wireless.mjs、frontend/verify-device-debugger.mjs、scripts/verify-lan-access.mjs、scripts/verify-startup.mjs。发布使用独立目录解压验收，不触碰真实ADB/日志/团队数据库，不把模拟验证说成真机完成。
- 每次交付报告实际模型与WorkBuddy使用情况；未返回积分必须写“积分未提供，无法确认”。

## 前端约定

本项目前端为 Vue 3 + Vite。以下为硬约束，违反即为缺陷，不是风格偏好。

1. **浮层必须 Teleport 到 body**：任何 `position: fixed` 的浮层（弹窗、下拉菜单、浮层提示）必须用 `<Teleport to="body">` 挂到 body 下。原因是 `.glass-panel` 上的 `backdrop-filter` 会创建包含块，使后代 fixed 改为相对该容器而非视口定位（详见 [styles/glass.css](frontend/src/styles/glass.css) 顶部说明）。验收见 `frontend/verify-device-debugger.mjs` 和安卓回归。
2. **颜色一律走 CSS 变量**：组件内禁止硬编码色值（含 rgba/hex）。主题差异只在 `theme.css` 声明，量值（字号/圆角/间距/动效时长）只在 `tokens.css` 声明；样式文件按 `tokens → theme → glass → layout → components → 业务样式` 单向依赖，后一层只许引用前一层变量。
3. **深色背景不用纯黑**：大面积底色用 `#090f18` 一类深蓝灰，保证玻璃高光与模糊有可感知层次。
4. **动效时长**：微交互 120~180ms，主题切换 200~300ms；禁止弹跳、大幅缩放、强发光。
5. **图标统一 Lucide 风格**：内联 SVG，`stroke-width` 1.7~1.9；禁止 Emoji 图标、3D 图标、混用多套图标库。
6. **backdrop-filter 不层层嵌套**：只允许大型容器（`.glass-panel` / `.overlay` / `.dialog`）使用；列表项、按钮、输入框一律用半透明背景色。
7. **响应式逐级折叠**，不整体缩放页面；`.app-layout` 保持 `min-width: 1280px`（窄屏横向滚动而非缩放）。
8. **浮层定位先测量后落位**：菜单类浮层应先渲染、测量真实尺寸再夹取到视口内，不硬编码宽度；菜单用 `ref` 取元素而非 `querySelector`（同类浮层会取错）。
9. **破坏性操作需二次确认**：永久删除、清空回收站等不可逆操作必须经用户显式确认（`?confirm=1` 或前端确认弹窗），且失败原因要写进操作日志，不得静默吞掉。
10. **验收脚本自造数据必须按特征全量回收**：清理时按名称特征（如 `/^AM\d{4,}/`）搜索并删除，**不得只硬编码本轮的 id** —— 脚本被中断时 exit 处理器里的异步请求不会跑完，只删本轮 id 会留下垃圾数据污染演示库。

### 验收脚本索引

- frontend/verify-android-wireless.mjs：原安卓连接、设置/帮助、命令、APK、Logcat与截图完整回归。
- frontend/verify-android-persistent.mjs：合成ADB文件目录、预览/下载、添加/替换/冲突与生命周期。
- frontend/verify-device-debugger.mjs：独立首页/设置、真实合成Unity HTTP协议/筛选/下载/取消。
- scripts/verify-lan-access.mjs、verify-startup.mjs：真实TCP保护及隔离Windows启停。

## 安卓调试边界（F-ADB-001）

- ADB 仅在服务器执行，模块 API 按 F-OPS-005 支持 Local/Lan，检查真实连接来源及服务器 Host；保留浏览器来源检查、JSON 和专用请求头要求，不信任代理转发头。仅 `POST /api/android/persistent/upload`、`POST /api/android/apk/inspect`、`POST /api/android/apk/install` 、`POST /api/android/apk/install-batch` 与 `POST /api/android/apk/install-many` 接受带专用头的 `application/octet-stream`，不得放宽其他接口的 JSON 要求。
- 进程调用使用参数数组、禁用本机 Shell、隐藏窗口、输出限制、超时与取消；自定义命令限 TASK-026 的已保存 ID、版本及确认执行，不增加临时自由执行接口或全局断开。
- 六位码配对只使用短期缓存的 mDNS 配对服务；二维码配对只匹配当前短期会话生成的随机服务名。六位码与二维码随机口令仅经 stdin 传给 ADB，禁止写入进程参数、文件或日志。二维码内容仅在会话创建响应中返回当前通过访问校验的页面，状态接口不得回传口令。
- 文件夹扫描必须异步、有深度/目录/条目/结果/时间上限，不跟随子目录链接；多个 ADB 候选由用户选择，校验版本成功后才能保存。兼容既有可执行文件路径和 `ADB_PATH`，不需要 SQLite 或配置结构迁移。
- 扫码会话两分钟有效，可在 ADB 忙碌时取消；取消、到期、配置变化和页面离开后清理口令与二维码。只能自动连接刚配对手机的连接服务；出现同地址多设备歧义时要求手动选择。扫码状态逻辑位于 `android-qr.js`，文件夹搜索位于 `android-adb-search.js`，公共解析位于 `android-adb-protocol.js`。
- ADB 路径持久化到 `data/android-adb.json`（`ADB_PATH` 优先）；自定义命令单独保存到机器配置 `data/android-commands.json`，不放入团队备份。设备、发现服务和配对码均为瞬时状态。
- 断开必须确认明确的单台无线设备，连接和断开后刷新列表，并区分操作失败与操作成功后刷新失败。
- ADB 配置由 `AndroidAdbSettings.vue` 负责，经 `AndroidSettingsDialog.vue` 在调试页与设置页复用；操作说明由 `AndroidHelp.vue` 点击后弹出。弹窗必须 Teleport 到 body，支持键盘关闭与焦点恢复。调试页左侧为设备连接和列表，右侧为命令、APK、屏幕与日志，两栏独立滚动。常用命令位于 `AndroidCommands.vue`，内置仅保留锁定程序、恢复桌面、IP、设备信息、内存与 CPU 六项；接受服务端内置或保存的自定义命令 ID，HOME 命令仅额外接受经过校验的 `component` 与 `userId`，其他命令拒绝这两项及任意附加参数。执行前重新验证目标为 `device`，必须插入 `-s <serial>`。输出不持久化。
- `android-home.js` 通过 `am get-current-user`、限定 HOME Intent 的 `cmd package query-activities/resolve-activity` 读取当前用户、候选与默认值；组件严格校验、规范化并限量。设置必须布尔确认，复核当前用户及实际候选，再执行 `cmd package set-home-activity --user <用户> <组件>`，检查成功输出并复查默认包，失败不能冒称成功。总时限 30 秒，子命令各有输出/超时上限和取消；不猜测普通应用的启动页，不自动启动应用，也不实现禁退锁定。`AndroidHomeSelector.vue` 管理搜索与主动选择，换设备/命令/配置或离页清理；候选、用户与结果只在内存。IP 查询全部接口 IPv4；内存与 CPU 是 dumpsys 快照，不新增后台采集。
- `android-custom-commands.js` 校验单条参数并解析引号，拒绝 `adb` 前缀、全局选项、连接管理和 Shell 管道/重定向/拼接；远端 `shell` 参数须按字面量转义，不能仅依赖本机 `shell:false`。自定义执行总是要求布尔确认和当前版本；修改/删除也核对版本，内置不可修改。命令库原子保存，损坏时拒绝覆盖，原文与结果不记操作日志。编辑弹窗失败保留草稿，不触发执行。
- `android-logcat.js` 只使用固定 `-s <serial> logcat -v threadtime -T 100` 参数读取在线设备。服务端最多保留一个短期会话，缓存最多 2000 条或 1 MiB，单行最多 4096 字符，未完成单行缓冲超过 65536 字符时停止；每次轮询最多 300 条，15 秒无心跳终止进程。日志正文只在内存，不写配置、数据库或操作日志。停止不占用普通命令锁，切换设备、离页、配置变化、对应设备断开/重启及服务器退出必须结束采集；不提供清空手机缓冲区的操作。`AndroidLogcat.vue` 负责过滤、自动滚动和最多 2000 条的页面缓存。
- 安卓原生下拉统一使用 `android.css` 的 `.adb-select`，底色不透明，选项/选中/禁用态按主题配色。主题切换时文字与底色同步更新，避免全局输入框背景动画造成瞬时低对比。
- `android-apk.js` 只允许已确认的单个完整 APK、最多 1 GiB、明确在线授权设备；上传流写系统临时目录随机私有文件夹，不能接受客户端路径或原始 ADB 参数，不得把整个 APK 缓存在内存。校验 ZIP 结构和根 AndroidManifest.xml 后再次验证设备，用固定 `-s <serial> install -r <临时包>` 覆盖并保留数据，不自动卸载、降级、授权或启动应用。与普通命令共用独占锁，上传与安装各五分钟，输出限量，取消/断连/离页/服务退出后回收进程及临时文件。上传百分比不能冒充安装进度；仅明确 Success 且无失败标识才显示成功，取消需说明手机最终状态不能回滚。包名和输出不入操作日志，临时 APK 不入数据库或备份。新增测试在 `android-apk.test.js`，浏览器验收继续使用离线执行器。
- 多设备 APK 安装只接受已确认的 1～20 个不重复序列号；复制目标快照、一次上传并复用同一临时包逐台安装。每台重新检查在线授权、独立五分钟时限；单台失败或超时必须继续其他设备并明确部分失败。批量端点用 NDJSON 返回实时结果与最终汇总，HTTP 流断开、用户取消、离页或服务退出须停止当前及后续队列并清理；已完成安装不回滚。前端必须收到汇总才确认整批结束，异常中断保留已知结果并提示核对；失败重选仅选当前在线失败项且必须重新确认。文件、目标和结果不持久化，保留原单台接口及 JSON 响应。
- `android-apps.js` 只读查询明确在线设备上的包名、安装路径与进程，包名必须严格校验，参数固定为 `pm list packages`、`pm path <包名>`、`ps -A -w -o PID,NAME`，查询有超时和输出上限；使用宽输出避免长包名截断。列表最多 2000 个包名；运行状态按精确包名或 `包名:` 子进程名匹配，不能按任意子串猜测 PID。应用日志只把匹配 PID 的内容加入缓存并返回浏览器；心跳最多每两秒刷新一次 PID 集合，不另起永久扫描定时器，停止时取消在途查询。所有状态只在内存，不自动启动/停止手机应用，不把进程存在等同于前台或健康状态；短暂进程/特殊进程名/系统代写日志的限制必须在帮助中说明。
- `android-screen.js` 只读在线且已授权的明确设备，以固定 `-s <serial> exec-out screencap -p` 参数读取原始二进制，禁止复用 UTF-8 文本 runner。设备检查与截图总时限 12 秒，图片输出最多 16 MiB、错误输出最多 4096 字节，验证 PNG 签名、块边界与 CRC、IHDR/IDAT/IEND、单边 16384 和总像素 32 Mi 上限。全服务最多一个在途截图，不占普通命令锁；请求取消、配置变化、对应设备断开/重启和服务退出时取消。API 复用本机保护，返回不缓存的 PNG；图片不写磁盘、数据库或日志。
- `AndroidScreenPreview.vue` 默认不读取，必须选择设备；连续刷新在上次读取完成后等待所选间隔，不重叠请求。停止保留最后画面，清空会停止并撤销图片 URL；替换、取消解码、切换设备、设备消失、配置变化和卸载时释放 Blob URL。页面进入后台时停止并保留最后画面，离页清空；放大弹窗必须 Teleport 到 body 并支持 Escape 与焦点恢复。帮助须说明截图刷新速度及受保护内容的显示限制。
- 修改后运行 `backend` 的 `npm test`（包含 `android-adb.test.js`、`android-adb-search.test.js`、`android-qr.test.js`、`android-adb-commands.test.js`、`android-home.test.js`、`android-custom-commands.test.js`、`android-apk.test.js`、`android-logcat.test.js`、`android-apps.test.js` 和 `android-screen.test.js`）、前端构建和 `node frontend/verify-android-wireless.mjs`。浏览器验收使用临时配置与离线执行器，结束清理临时目录；不得把模拟验证宣称为真实手机验证。

## Unity 局域网日志边界（F-ULOG-001）

- 入口 `UnityLogs.vue` / `/tools/unity-logs`；`unity-log-client.js` 只请求本机后端。`unity-log-view.js` 解析与筛选整条日志，Vue 插值展示正文；预览限 256 KiB、显示限 1000 条。CSS 延续 tokens/theme 约束。
- `unity-log-discovery.js` 按本机私有 IPv4 掩码生成有界候选，仅探测 TCP 日志端口和固定发现协议；默认 1024 地址、64 并发、25 秒总限，报告实际检查范围。指定 IP 也必须属于本机真实私网网段；不能接收自由 URL 或探测公网。
- `unity-log-http.js` 固定路径、严格文件名校验，不跟随重定向；缓冲与流式读取都必须有完整请求超时、取消和响应大小限制。流建立到消费端之间的错误必须被捕获，避免未处理事件或挂起。
- `unity-logs.js` 只在内存缓存发现结果与短期读取会话，最多八个会话，票据不回传浏览器、不记日志、不落盘；重连核对固定编号及 App ID。`unity-log-api.js` 通过共用网络策略校验 Local/Lan 真实来源、服务器 Host/Origin、JSON 与专用头，不信任转发头。文件只读，下载交给浏览器，不自动写团队数据库或备份。
- 取消、切换设备、离页及服务器关闭必须取消在途请求；连接已建立但响应未交付时回收会话。页面后台暂停读取与连接。失败保留上次成功的预览，不能仍标记为正常读取。
- Unity 改动限定 `Assets/Test/Log`，不得改 AnchorFrame 或原 GameLogic 日志模块；不得手改场景/预制体 YAML。设备新增发现协议位于 AOT，需完整重新打包。真实 Android/iPad 权限、网络和后台恢复需硬件单独验证，不能把本机 C# 协议联调当作真机测试。
- 改动后运行完整 `backend` 的 `npm test`（包含 `unity-log-discovery.test.js`、`unity-logs.test.js`、`unity-log-api.test.js`）及前端构建；用隔离 C# 服务提供合成日志，通过浏览器验证搜索、历史、筛选/复制/下载、错误恢复、取消与离页。不得读写真实团队数据库或将合成日志混入设备数据；验证后关闭临时服务。

## Unity persistentDataPath（F-ADB-002 / TASK-039）

- 两产品共享android-persistent与专用Vue面板。仅当前Android用户的标准外部files目录，明确在线设备/已安装包名；固定脚本逐级拒绝符号链接/越级，脚本及参数分别POSIX转义，不开放自由路径或命令。
- 浏览1000项，预览256KiB，单文件上传/下载256MiB；流式私有临时文件，读取/替换SHA256复核。添加拒绝同名；替换必须选择原文件并确认。不能自动停止App，无法锁住App写入，帮助说明并发限制。
- 二进制仅专用upload，专用头/同源/真实网段保护不变。失败/取消/断连/退出回收进程与临时文件，日志不含正文；不入数据库/备份。运行android-persistent.test.js与verify-android-persistent.mjs，真机另验。

## 查看 APK 包名（F-ADB-003 / TASK-040）

- apk/inspect独立于ADB配置/设备，只接收单个APK流；专用头、同源和真实网段规则不变，仅此精确端点新增二进制许可。不能执行/安装APK、运行SDK或接收本机路径。
- 复用流式临时接收，单任务、1GiB APK、16MiB清单、五分钟总限；有界ZIP及二进制XML、CRC/长度校验，拒绝损坏/重复/加密清单和资源引用包名。取消/断连/离页/后台/退出回收，日志不记包名/文件名/正文，不入数据库或备份。
- 修改后执行android-apk-info.test.js、两后端完整测试/前端构建、verify-android-apk-info.mjs及安卓回归；验收使用合成APK/隔离浏览器，不安装到真实手机。
- `frontend/verify-android-apk-info.mjs` 覆盖无ADB读取、UTF8/UTF16、复制/失败重试、换文件/清空、错误恢复、取消/后台/离页及明暗布局；可补充公开APK哈希与源码包名核对，不得把只读解析当作手机安装验收。

## 多 APK 安装队列（F-ADB-001 / TASK-042）

- /apk/install-many是唯一新增二进制端点，保持专用头、同源、真实网段和明确确认；64KiB元数据、1～20包/设备、每包1GiB及总4GiB，流式随机私有暂存，全部APK校验后才能执行。禁止接受路径或自由ADB参数。
- 最多两设备并行、每台按文件顺序串行，每项五分钟/队列一小时；单项失败继续。可确认精确失败任务矩阵，不能以失败设备与文件的笛卡尔积误装成功项。取消/断连/后台/离页/退出停止全部活动/后续任务，等待全部工作线程退出后清理。保留旧单包安装端点。
- 执行android-apk-queue.test.js、完整后端/构建、原安卓和新多APK浏览器回归，两产品及最终发布包同步验证；只用离线执行器和合成APK，不声称真机完成。
