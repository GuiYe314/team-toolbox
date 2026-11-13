# 项目状态（PROJECT_STATUS）— 唯一状态源

## v0.6.0 正式发布（2026-11-13）

**源码上传及正式发布完成**：[v0.6.0](https://github.com/GuiYe314/team-toolbox/releases/tag/v0.6.0)，Release ID **444348662**，非草稿、非预发布，已为仓库 latest。发行源码与 v0.6.0 标签指向 **fb2a7302885639ecda47b8434a93dea21431f6b8**，已推送 main；本条结果另作文档提交，不移动发行标签或重建已验收资产。

本次只更新完整工具箱的 TASK-045。卡片可放到目标前/后、直接移到首尾，支持浏览器个人排序、首页相对排序、恢复默认、取消及保存失败重试；原生下拉采用清晰明暗主题。独立设备调试工具不变。前后端源码和锁文件统一 0.6.0，下方 TASK-045 的 27/27 是补充修改前历史结果。

- 本轮完整后端 **664/664（51 suites）**、前端计算 **29/29**；最终 ZIP 中 **295** 个文件摘要与源码/构建一致，随包依赖、组件、许可及版本/清单校验通过。
- 最终 ZIP 排序/下拉浏览器 **30/30**，安卓 **187/187**，网速 **30/30**、端口 **28/28**、集成 **49/49**；生产通用网页 **53/53**、实际 Local/Lan 启停 **11/11**、跨 Node 运行时 **14/14**、最终安装器与真实 v0.5.0 隔离升级 **21/21**。截图已目视，设备回归使用离线夹具，不代表真机验证。
- 生产接口、真实 CC0 分析/MP3 转换/领取/回收及网卡读取前 **35** 项通过；实际 Windows 端口采集连续三次超过既有15秒上限，返回503/timeout，**此项未通过，生产整套不得称为46/46**。端口采集器代码本轮未变；通用网页与 Local/Lan 后续用独立检查完成。
- 首次安装脚本中文输出编码问题已修复，临时安装通过本轮卸载器清理，原机器安装注册未变；外站下载失败保留日志，有限重试后实际成功；续接脚本变量遗漏与端口退出子进程竞态也保留早期失败记录。完整范围、证据与最终四份资产摘要见[封版记录](acceptance/V0_6_0_RELEASE_2026-11-13.md)。
- 四份远端资产的大小、uploaded 状态及 GitHub SHA256 digest 逐项与最终本地文件一致，正式发布后再次核对；通过工具箱实际更新 HTTP 客户端匿名读取公开 latest 清单，**687字节**且逐字节一致，SHA256 为 `92e4b5b3556a6251d63754dcbaaa615def0aa07bce390fef5cf47652426916ee`。证据：build/v060-release-draft.json、v060-release-published.json、v060-public-manifest-updater.json。curl 直连超时/重置未计成功，更新器沿用既有请求级代理逻辑读取成功。

下一步：下载本产品安装器或便携 ZIP，或在原主工具箱设置中检查 GitHub 更新。个人工具排序按当前浏览器/访问地址分别保留。真实端口采集超时仍需另行排查，本次不宣称其通过；没有为发布重启或替换用户真实运行实例，不读取、复制团队数据或操作真实手机。旧版标签/资产与独立版保持原状。

Codex 完成，未调用 WorkBuddy；积分未提供，无法确认。

## TASK-045 工具卡片排序与下拉菜单可读性（2026-11-13）

**代码与文档完成，尚未提交、推送或重发发布包。** 工具箱页面卡片支持拖拽调整前后顺序，顺序保存在当前浏览器并同步首页；新增“恢复默认顺序”入口。全局原生下拉框及菜单项改用明暗主题的不透明背景和明确文字色，修复浅色选项难以辨认的问题。排序偏好不进入团队数据库或备份。

- 变更：`frontend/src/utils/tool-order.js`、工具箱/Home 排序接入、`components.css` 下拉菜单主题规则、排序单元测试及用户/架构/规格文档。
- 验证：`frontend` 的 `npm test` **27/27** 通过；`npm run build` **通过**（1598 modules transformed）。首次未提权构建受当前沙箱中文路径访问限制失败，使用项目允许的构建权限复验通过；未运行真实手机或外部服务。
- 下一步：需要时在浏览器打开“工具箱”，拖动卡片确认排序；发布前再按现有封版流程重打包并更新版本说明。

## v0.5.0 正式发布（2026-11-12）

**源码上传及正式发布完成**：[v0.5.0](https://github.com/GuiYe314/team-toolbox/releases/tag/v0.5.0)，Release ID **442866258**，非草稿、非预发布。本产品为仓库latest。发行源码/标签为 **0da6700217264d472df06d80f3d984770033d8a6**，已推送main；本条结果另作文档提交，不移动发布标签，不重建已验收资产。

- 两产品各四份远端资产的名称、大小、uploaded状态和GitHub SHA256 digest逐项与最终本地文件一致；匿名下载latest的manifest.json，**632字节**，SHA256为`7024fe0e153f1d4c7fddafa596e2f2a0d14aec5778b1ae368b78a3c986d67fc0`，与本地逐字节一致。最终资产和验收范围见[封版记录](acceptance/V0_5_0_RELEASE_2026-11-12.md)；证据：build/v050-release-draft.json、v050-release-published.json、v050-public-manifest.json。
- 主线最终后端 **664/664（51 suites）**、前端计算 **23/23**、最终ZIP文件哈希 **289项**、生产Local/Lan及真实端口/网卡/下载 **46/46**、通用网页 **53/53**、运行时 **14/14**、最终安装器及真实v0.4.0隔离升级 **18/18**、端口网页 **28/28**、两产品图标网页 **36/36**。独立版完整后端 **223/223**、最终ZIP/安装器 **38/38**、安卓/文件/包名/多APK/独立Unity网页各 **187/187、24/24、18/18、23/23、19/19**、LAN **7/7**、Windows启停 **15/15**。全部最终结果和日志路径见封版记录。
- 首次主线两个测试命中Fetch禁止的临时端口，未计通过；完整复验664/664。独立版首次并行Inno文件占用后单独构建通过。首次并行Git push遇远端临时对象包目录错误，两分支分别重传成功，远端分支/解引用标签已核对；不强制推送、不覆盖旧标签/资产。草稿按标签接口不可见时改按返回ID核对，没有重复创建发布。
- 发布后核对设备版正式发布仍保持主线latest=v0.4.0，再将主线v0.5.0发布为latest；最终公开主线清单指向0.5.0 ZIP，设备清单保持独立。旧版ZIP/EXE及既有发布不改。
- 当前源码实例已隐藏启动：主线 **Development/Lan 3001/5173**，独立版 **Release/Lan 3100**，健康分别自报0.5.0/0.2.1。本机及192.168.100.39的版本、原源码数据路径、SPA/ICO、5173代理跟随3001、真实端口快照、跨站保护及已安装旧版健康共 **21/21**。首次启动发现3000由`%LOCALAPPDATA%/team-toolbox`的0.4.0占用，未结束该实例；只恢复本项目5173并给源码后端选3001，原源码data与已安装版data分开保留。证据：主线build/v050-live-restart.log、v050-v021-live-final.log，独立build/v021-live-restart.log。没有复制两产品配置、调用真实ADB或对真实程序执行apply。

下一步：下载本产品新版安装器或便携ZIP；主工具箱旧版也可在设置检查项目GitHub更新，设备调试工具继续手动升级。当前源码网页为5173/3100，刷新即可看到新图标；移动程序目录后重新运行“创建快捷方式.cmd”。真机扫码、安装、Android文件权限及另一物理客户端仍未验收；端口信息属于运行服务器的瞬时只读快照。运行数据、测试夹具、日志、构建产物和本机.lnk不入源码。

Codex 完成，未调用 WorkBuddy；积分未提供，无法确认。

## TASK-044 采用 06 石墨字标（2026-11-12）

**两产品源码、当前网页与 Windows 快捷方式接入和验证完成；未提交、推送或重发发行包。** 用户选择06后，完整工具箱采用TT、独立设备调试采用DD。侧栏、SVG/ICO/PNG favicon和触摸图标同源；主线保存26个ICO/SVG，独立版仅保存14个设备相关图标。创建入口只在项目“快捷方式/”生成启动/关闭.lnk；发布脚本与安装模板包含资产、辅助脚本及安装器/程序列表/开始菜单/可选桌面图标，不改变数据或业务功能。

- 两产品最终Vite生产构建通过；主线只有既有大块体积提示。完整后端分别 **664/664（51 suites）**、**223/223**，均限制并发为2；主线前端计算 **23/23**。各产品证据：build/icons-06-build.log、icons-06-backend.log；主线另有icons-06-frontend-tests.log。图标修正后没有重复无关业务测试。
- 隔离生产页面/临时浏览器 **36/36**，包含两套9个静态资源逐字节核对、Windows/网页ICO一致、真实图像加载、favicon声明、明暗主题及1280/1600侧栏边界，无浏览器异常/外部资产请求。首次目视发现主线浅色玻璃高光遮淡品牌，已仅提升品牌绘制层并重建复验；四张最终截图及对照已目视。证据位于主线build/icons-06-browser-final.log、icons-06-brand-review-final.png。
- 真实Windows快捷方式与安装模板隔离验收 **26/26**：反读四个源码.lnk目标/工作目录/图标、用独立测试安装身份与最小图标载荷编译两份模板、实际安装/核对启动关闭卸载三个图标/发布目录生成入口并卸载移除菜单。未启动载荷或修改原安装身份；这是图标/模板验证，不是新整包运行时验收。证据：主线build/icons-06-windows.log及两产品build/icons-06-validation-*的compile/install日志。
- 40个所选ICO共 **440帧**逐帧解码、透明通道与原画稿字节核对；70张Windows原生位图与所选帧逐像素一致，两份测试安装EXE的实际Icon.ToBitmap也与产品32px画稿逐像素一致。旧版GDI的三次256px请求选择192px DIB，256px PNG另行逐帧解码；原生Icon.Save的序列化颜色不用于显示验收。证据：主线build/icons-06-assets.json。PS脚本BOM/语法、CMD纯ASCII/CRLF与本机.lnk的Git忽略均核对。
- 当前127.0.0.1及192.168.100.39的5173/3100页面、SVG/ICO/触摸图标与源文件逐字节核对，3000/3100健康共 **18/18**。生产静态目录重建后直接提供新文件，本轮未停止服务、调用ADB或改变配置。证据：主线build/icons-06-live.log。

下一步：刷新5173或3100网页；两项目的“快捷方式/”已生成可复制到桌面的入口，移动目录后重新运行根目录“创建快捷方式.cmd”。分发新版时需另行构建并做完整ZIP/安装器运行时验收；既有v0.4.0与device-debugger-v0.2.0远端/本地发行文件未改。完整工具箱原有TASK-043端口查看改动继续保留。

Codex 完成，未调用 WorkBuddy；积分未提供，无法确认。

## TASK-043 端口查看与图标候选（2026-11-12）

**端口查看源码、构建和本机验证完成；图标候选已交付，用户选择06的接入见TASK-044。** 完整工具箱首页与工具箱增加`/tools/ports`，只读运行服务器的Windows TCP/UDP端点、监听/连接状态、地址、PID和进程名；支持协议/监听范围/精确本地端口/关键词筛选、分页、复制、5秒自动/手动刷新、失败保留旧快照和后台/离页取消。无新依赖或数据迁移，不扫描其他设备或结束进程，独立设备调试版不增加此工具。

- 完整后端 **664/664（51 suites）**，以package.json完整列表加`--test-concurrency=2`执行；新增12项覆盖固定隐藏进程、IPv6/数字状态、限量/脱敏、缓存/并发、单/全部取消、超时、退出及API同源/专用头/方法保护。前端计算 **23/23**，最终Vite生产构建通过，只有既有大块提示。日志：build/ports-backend.log、ports-frontend-tests.log、ports-build.log。
- 隔离生产页面浏览器 **28/28**，包含入口、分类/精确端口/进程/PID/IPv6筛选、100条分页、复制、HTML字面显示、失败重试/旧快照/截断/空列表、自动与后台/离页取消、迟到结果、明暗1280/1600布局和下拉文字对比度，无浏览器异常或外站请求。日志：build/ports-browser-final.log，ports-light.png/ports-dark.png已目视。首次无头浏览器复制未获权限，测试配置补充临时浏览器的剪贴板许可及焦点后完成复验，产品未放宽权限。
- Windows真实只读对照 **4/4**：临时TCP监听、UDP绑定与当前Node的端口/PID精确匹配，已有3000/3100/5173监听可见，无命令行/路径属性；临时监听结束即关闭。实际复验约 **4.6秒**、667条端点、无截断。初次与完整测试/构建并发时触发15秒时限，未记通过；单独命令测量和受控监听复验通过，超时仍以可恢复失败反馈。证据：build/ports-real-windows.log（首次失败）、ports-real-windows-final.log（最终通过）。
- 已按本项目绝对路径隐藏重启，保留Development/Lan **3000/5173**。本机及192.168.100.39的端口深链、真实快照/工具箱监听、无专用头/跨站/附加参数403，以及独立3100健康共 **11/11**；未复制配置、操作手机或修改网络。证据：build/ports-live-restart.log、ports-live-smoke.log。另一物理客户端及其他Windows版本未实测。
- 图标位于本机工作区`工具/图标候选/2026-11-12`，共 **6套×26个=156个ICO**，包含工具箱、设备调试、启动/关闭/安装/卸载及各工具；每个ICO均有16/20/24/32/40/48/64/96/128/192/256共11帧，逐帧解码及透明圆角验证通过。另附512px PNG、可编辑SVG、网页尺寸、六套总览、逐套预览、HTML选择器和21,692,640字节ZIP。Windows System.Drawing可读取12个主产品ICO，ZIP完整/156项及SHA256核对通过，总览及全套图标已目视并修正启动图形越界。生成器与ICO验证结果随包，不含字体、上游商标或联网生成；候选文件在仓库外，Git不自动同步这些本机资产。

下一步：刷新[本机端口页](http://127.0.0.1:5173/tools/ports)即可使用；用户已选择06，快捷方式/安装器/网页接入见TASK-044。当前代码未提交、推送或发布新版，既有v0.4.0和device-debugger-v0.2.0发行资产未变。

Codex 完成，未调用 WorkBuddy；积分未提供，无法确认。

## TASK-042 多 APK 安装队列（2026-11-12）

**两产品实现、最终构建和隔离验收完成，已纳入本轮发布文件。** 面板支持选择1～20个完整APK及1～20台设备；多文件时最多两台并行，每台按文件顺序安装，逐项反馈并精确重试失败的设备与文件组合。每包1GiB、整批4GiB，保留确认覆盖、取消及临时清理；不改变配置或数据库结构。

- 原工具箱完整后端 **652/652（51 suites）**、前端计算 **19/19**，独立版后端 **223/223**；随包Node22.22.2的原安装、包名及多APK专项 **41/41**。两套最终生产构建通过，主线仅有既有大块体积提示。日志：build/v040-backend-final.log、v040-frontend-tests.log、v040-node22-apk.log；独立目录build/v020-backend-queue-final.log。
- 两套最终多APK浏览器各 **23/23**、原安卓各 **187/187**、Unity文件各 **24/24**、APK包名各 **18/18**；独立导航/设置/合成Unity日志 **19/19**。覆盖单/多设备、多文件、失败后继续、精确重试、取消/后台/离页和明暗布局，无浏览器异常。证据：两目录build/final-verify-android-*.log，独立目录另有final-verify-device-debugger.log；多APK明暗截图已目视。
- 最终ZIP包含对应源码与前端构建，完整包 **42/42** 生产检查、安装器及真实旧版隔离升级 **15/15**、运行时 **14/14**；独立ZIP/EXE **36/36**。详细范围与资产摘要见下方封版报告。多APK使用离线ADB与合成APK，不代表真实手机安装验收。


## v0.4.0 封版（2026-11-12）

**正式发布完成**：[team-toolbox v0.4.0](https://github.com/GuiYe314/team-toolbox/releases/tag/v0.4.0)，Release ID **442766220**，非草稿、非预发布，latest已指向v0.4.0。范围为TASK-037、TASK-039～042；源码及两份锁文件统一0.4.0，发布源码与标签指向 **0195eaeadd3db79803a45c736fdb0bd7fbad6d0a**。本次远端结果另作文档提交，不移动已发布标签。

- main及新标签已推送，四份远端资产名称、大小、uploaded状态及SHA256 digest逐项与最终本地文件一致。最终ZIP/EXE、生产Local/Lan、内置组件真实下载、实际安装卸载和真实v0.3.1隔离升级证据与完整摘要见[封版记录](acceptance/V0_4_0_RELEASE_2026-11-12.md)。已验收二进制未因文档补记重建，旧发布资产未覆盖。
- 实际匿名下载`releases/latest/download/manifest.json`，与本地656字节清单逐字节摘要一致：`62419a131fec91d4b04a1019f266923c296fd6f3506de0cdbce8f21f6d49e186`。清单指向0.4.0最终ZIP。证据：build/v040-release-draft.json、v040-release-published.json、v040-main-latest.json、v040-public-manifest.json。
- [独立设备调试版v0.2.0](https://github.com/GuiYe314/team-toolbox/releases/tag/device-debugger-v0.2.0)亦已正式发布，ID **442766336**，源码/标签为 **a3d453b235154fb793f4fe585b0326c79ade8578**，明确保持非latest；其四份资产和公开精确清单均已核对，没有取代主工具箱自动更新清单。
- 真实源码服务已按绝对项目身份隐藏启动并保持原模式：本产品Development/Lan **3000/5173**、独立版Release/Lan **3100**，健康分别自报0.4.0及0.2.0。本机及192.168.100.39的健康/安卓深链、新安装端点空无效请求400、缺少专用头/跨站403共 **20/20**。证据：build/v040-live-restart.log、v040-v020-live-final.log；没有发送APK、调用ADB、复制两产品配置或对真实项目执行apply。

下一步：刷新本机5173或3100的安卓调试页，多选APK并核对目标后确认安装；分发可使用各自安装包或便携ZIP，原工具箱v0.3.1也可主动检查项目GitHub更新。实际多手机安装、扫码、Android权限及另一物理客户端仍未验收；取消不能回滚已经完成的安装。原MVP后续仍为TASK-010与TASK-009剩余范围。

Codex 完成，未调用 WorkBuddy；积分未提供，无法确认。

## TASK-041 Yoinks 下载引擎内置（2026-11-12）

**本地代码、内置组件、构建和实际下载验证完成。** 原网页已具备Yoinks的yt-dlp调用，但本机缺少组件；现增加本产品固定yt-dlp、ffmpeg/ffprobe，空配置优先自动识别，设置可恢复内置或选择已有版本。新版JS解析使用当前Node，网页及日常启动不联网安装引擎；没有新增依赖、机器配置格式或数据库迁移。

- 固定官方 yt-dlp **2026.10.26**、ffmpeg/ffprobe **6.1.1 Windows x64**，下载资产、gzip成品及许可全文逐一SHA256核验。`node scripts/prepare-media-tools.mjs`实际准备成功，`--check`离线核验通过；版本与摘要位于scripts/media-tools.lock.json，来源与源码见OPEN_SOURCE_INTEGRATIONS。成品仅在Git忽略的vendor/media/win32-x64，未加入源码。证据：build/yoinks-components-prepare.log。
- 完整后端 **642/642（51 suites）**，执行backend/package.json全部测试文件并加`--test-concurrency=2`，无跳过；随包Node22.22.2执行integration与组件专项 **37/37**。新增覆盖内置/自定义/PATH优先级、固定锁白名单、分段/并发/续传/完整摘要、坏包及解压限量、失败保留原组件、许可完整性和发布暂存。日志：build/yoinks-components-backend.log、yoinks-components-node22.log。首次默认并发启动大量Node进程曾遇VirtualAlloc/进程创建失败，降低并发后完整复验通过，未把该失败计为功能通过。
- 最终前端生产构建通过，只有既有大块体积提示；`TT_VERIFY_LAN=1`的`frontend/verify-integrations.mjs` **49/49**，覆盖恢复内置及清空覆盖、视频/MP3保存与取消、错误/离页清理、另外两工具回归、Teleport/焦点、明暗主题和1280布局，浏览器异常为0。日志：build/yoinks-components-build.log、yoinks-components-browser.log；build/integrations-yoinks-light.png与dark.png已目视检查。
- 使用实际内置引擎读取公开[MDN CC0花朵视频](https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4)，完成视频下载、MP3提取、领取字节数及ffprobe音视频/时长核验，并清理结果；真实组件/许可复制到独立暂存目录后再次核验及空配置识别，共 **13/13**。日志：build/yoinks-components-real-engine.log。此项使用真实外站下载，非离线执行器；不代表所有站点或登录内容可用。
- 按本项目绝对路径隐藏重启，保持Development/Lan的3000/5173。当前本机及192.168.100.39网页/配置/健康均正常，两个组件source=bundled；实际局域网接口完成CC0分析、MP3下载/领取/清理、清理后410及跨站/缺少专用头/附加参数403，共 **15/15**。日志：build/yoinks-components-running.log。没有修改防火墙、系统PATH或其他软件。
- `scripts/build_release.ps1`接入同一准备与白名单暂存，PowerShell语法及真实隔离暂存通过；未重新打包、提交、推送或发布新版，已发布v0.3.1资产保持原样。真实ZIP/安装器整包验收待下次发版执行，不将组件暂存当作新版整包验收。原网速/APK包名等未提交修改保留，独立设备调试产品本轮不增加视频下载模块。

下一步：刷新[当前视频下载页](http://127.0.0.1:5173/tools/yoinks)，粘贴单个公开视频链接、分析并下载；同网段使用服务器IPv4:5173。真实下载受站点/网络/地区限制，不读取Cookie或处理登录/付费绕过；另一物理客户端和其他Windows版本未实测。需要分发时另行生成新版，原MVP后续仍为TASK-010与TASK-009剩余范围。

Codex 完成，未调用 WorkBuddy；积分未提供，无法确认。

## TASK-040 查看 APK 包名（2026-11-12）

**两产品源码、构建及当前本地服务验证完成。** 安卓调试右侧增加“查看 APK 包名”，选择单个 APK、主动读取并复制；无需 ADB、SDK 或手机。支持 UTF-8/UTF-16 编译清单、有界流式上传、完整性检查、取消及临时清理，没有新增依赖或持久化结构。

- 原工具箱完整后端 **633/633（51 suites）**、前端计算 **19/19**；独立版完整后端 **213/213**，随包 Node22.22.2 的新增专项 **9/9**。两套最终生产构建通过，主线仅有既有大块体积提示。日志：各目录 build/apk-info-backend.log、apk-info-build-final.log；主线 apk-info-frontend-tests.log，独立版 apk-info-node22.log。
- 两套实际私网地址的新增浏览器各 **18/18**、原安卓各 **187/187**、Unity文件面板各 **24/24**；独立导航/合成Unity日志 **18/18**、真实TCP代理 **7/7**、Windows启停 **15/15**。覆盖无ADB读取、复制/失败恢复、换文件/清空、坏包拒绝、取消/后台/离页，以及原安装/文件/日志/截图；无浏览器异常。日志：build/apk-info-browser.log、apk-info-android-regression.log、apk-info-persistent-regression.log，独立版另有 apk-info-unity-browser.log、apk-info-lan.log、apk-info-startup.log。两产品 apk-info-light.png / apk-info-dark.png 已目视检查。
- 只读核对公开 [Appium ApiDemos v6.0.18](https://github.com/appium/android-apidemos/releases/tag/v6.0.18) APK，大小6521217字节，SHA256 `a9eecf37b26cd084855c530db81c2bb1b91f4c1b095a04f47aa7c20e2791f686` 与GitHub发布摘要一致；解析 `io.appium.android.apis`，与同标签app/build.gradle的applicationId一致，没有安装或执行APK。
- 按绝对项目身份停止并隐藏启动，原工具箱 Development/Lan **3000/5173**、独立版 Release/Lan **3100**。本机及192.168.100.39的页面/健康、真实APK读取、坏包400、跨站/缺少专用头403、附加参数400及临时目录回收共 **30/30**；日志：build/apk-info-live-smoke.log。两套ADB配置保持独立，验证未调用ADB或访问手机。
- 本轮未提交、推送、重新打包或发布；已发布v0.3.1与device-debugger-v0.1.0资产不含本次修改。原有未提交实时网速功能保持原地，运行数据、测试APK、日志、截图和构建产物不入库。

下一步：刷新当前源码工具的安卓调试页即可使用；需要分发时另行生成新版。只读真实APK及隔离浏览器验收不代表手机安装验收，另一物理客户端未实测；原MVP下一任务仍为TASK-010与TASK-009剩余范围。

Codex 完成，未调用 WorkBuddy；积分未提供，无法确认。

- 2026-11-12 / TASK-039：**两产品代码、构建与隔离验收完成；真实手机未验收**。安卓调试新增当前用户标准 persistentDataPath 目录浏览、UTF-8 预览/下载、添加和确认替换，原文件变化检查、SHA256 传送校验、取消及生命周期清理。当前工作树完整后端 **624/624**、前端计算 **19/19**、安卓浏览器 **187/187**、新面板 **24/24**，最终构建通过；该工作树包含原先未提交的网速模块。独立版后端双 Node **204/204**、Unity 浏览器 **18/18**、发布包隔离 **30/30**，[独立版0.1.0](https://github.com/GuiYe314/team-toolbox/releases/tag/device-debugger-v0.1.0)已正式发布，四份资产核对一致，主线latest仍为v0.3.1。证据与限制见第4节，原网速改动保持原地。

- 更新日期：2026-11-11（**TASK-037 实时网速：代码、隔离浏览器与本机真实网卡验证完成**。首页/工具箱新增单网卡上下行速度、Mbps、60 秒趋势、观察期流量/平均/峰值，支持切换、暂停/清空与后台清理；共享按需 Windows 采集及受保护只读接口。完整后端 **609/609**、前端计算 **19/19**、隔离浏览器 **30/30**、最终生产构建通过。当前源码服务已按项目身份隐藏重启并保留 Lan，本机及 `192.168.100.39` 页面和新接口均通过，实际物理网卡连续采样正常。证据见第 4 节；本轮未提交、推送、打包或发布，v0.3.1 已发布资产保持原样。Codex 完成，未调用 WorkBuddy；积分未提供，无法确认。）

- 更新日期：2026-11-11（**v0.3.1 正式发布完成**：[GitHub Release](https://github.com/GuiYe314/team-toolbox/releases/tag/v0.3.1)，发布 ID `441321583`，非草稿、非预发布，`latest` 已指向 v0.3.1。`main` 与标签已上传，发布源码为 `e3ef19988b0b4373675611a765be5642bb6e5f22`；本条发布结果另作文档提交，不移动标签。四份远端资产大小和 SHA256 digest 全部匹配，公开最新清单已实际下载且字节一致。完整后端 **582/582**、发布运行时 **14/14**、Local/Lan 生产启停 **34/34**、生产 UI **53/53**、更新设置 **28/28**、独立替换/失败回滚 **20/20**，详情见 [封版记录](acceptance/V0_3_1_RELEASE_2026-11-11.md)。v0.3.0 Release 顶部已补充后台更新缺陷及手动升级提示，原正文和四份资产保留。真实源码服务已按项目身份隐藏重启为 0.3.1 并保留 Lan，本机/实际私网设置页均 HTTP 200；真实 GitHub 检查 current/latest 均为 0.3.1。没有对真实项目执行 apply。Codex 完成，未调用 WorkBuddy；积分未提供，无法确认。）

- 更新日期：2026-11-11（**TASK-036 GitHub 默认更新源：代码、隔离验收及当前实例验证完成**。支持仓库 HTTPS / .git 转换、项目默认源、关闭/恢复及换源缓存隔离；更新清单和 ZIP 单独使用环境或 Windows 手动 HTTP/HTTPS 代理，不改其他工具。后端 **581/581**、更新专项 **57/57**、发布运行时 Node 22.22.2 代理 **20/20**、设置页浏览器 **28/28**、生产构建通过。当前 Lan 服务按项目身份重启，本机和实际私网设置页 HTTP 200；真实 GitHub 清单检查成功，当前与最新均为 **0.3.0**。证据见第 4 节；本轮未执行真实下载安装、回滚、提交、推送或新版发布。Codex 完成，未调用 WorkBuddy；积分未提供，无法确认。）

- 更新日期：2026-11-10（**v0.3.0 正式发布完成**：[GitHub Release](https://github.com/GuiYe314/team-toolbox/releases/tag/v0.3.0) 非草稿、非预发布，`latest` 指向 v0.3.0，发布 ID `440299657`。`main` 及标签已上传；发布源码为 `134baceb8e554d4f104d4be5e584e87a5951b01d`，后续本条状态更新仅为文档提交，不移动发布标签。四份远端资产大小和 SHA256 digest 均匹配本地，公开 `releases/latest/download/manifest.json` 已实际下载且字节一致。范围为 TASK-028～035，源码/锁文件统一 0.3.0，内置 Node v22.22.2 / ABI 127。核对完整后端 **554/554**、局域网代理 **7/7**、启动停止 **15/15**、安卓浏览器 **187/187**、集成浏览器 **47/47**；本轮地球计算 **14/14**、地球浏览器 **61/61**、独立 ZIP 运行时 **14/14**、实际发布 CMD 的 Local/Lan 生产检查 **34/34**、通用 UI **53/53**、更新界面 **17/17**。45 个后端源码及 153 个前端产物逐项哈希一致，ZIP 无真实数据或源码测试，manifest/SHA256 与资产一致。首次 Inno 编译遇 Windows 错误 32，保持暂存内容后重试成功；负经度验收表达式已修正。详细记录见 [封版报告](acceptance/V0_3_0_RELEASE_2026-11-10.md)，远端核对证据为本机 `build/v030-remote-latest.json` 和 `build/v030-latest-manifest.json`。隔离服务已停止，开发服务保留并复核健康；真机、另一物理客户端和真实上游未验证。Codex 完成，未调用 WorkBuddy；积分未提供，无法确认。）

- 更新日期：2026-11-10（**TASK-035 全工具局域网访问：代码、隔离验收与当前实例切换完成；另一物理设备未实测**。Windows 默认 Lan/可选 Local，全部工具共用真实私网来源、Host 和同源保护，Vite 代理前校验；服务器位置提示、HTTP 复制与停止脚本构建隔离同步修正。完整后端 **554/554**、开发代理 **7/7**、启动停止 **15/15**、私网安卓浏览器 **187/187**、集成浏览器 **47/47**、最终前端构建通过。当前后端与前端已监听 IPv4，实际私网 IP 页面及只读接口复核通过。证据见第 4 节；未修改防火墙/网络类别，未进行真实设备或供应商操作、推送、打包或发布。Codex 完成，未调用 WorkBuddy；积分未提供，无法确认。）

- 更新日期：2026-11-10（**TASK-034 三项开源工具接入：代码与隔离验收完成；真实上游运行未验证**。首页/工具箱新增 Yoinks 视频下载、FreeLLMAPI 模型聊天、ArtCraft 提示词和本机确认启动；独立本机设置、Key 仅内存、取消/超时/临时清理、主题与帮助。新增专项 **28/28**、完整后端 **541/541**、浏览器 **44/44**、最终前端构建通过，证据见第 4 节。未安装上游程序、调用真实供应商、推送、打包或发布；ArtCraft 原生编辑器在自身窗口。Codex 直接实施，未调用 WorkBuddy；积分未提供，无法确认。）

- 更新日期：2026-11-10（**TASK-033 多设备 APK 安装：代码与离线/浏览器验收完成；真机未验证**。同一 APK 一次上传后逐台安装到最多 20 台所选在线设备，增加多选/全选、完整确认、逐台实时结果、部分失败继续、失败重选及取消清理；保留单台安装。APK 单项 **22/22**、完整后端 **513/513**、安卓浏览器 **187/187**、前端构建通过，证据见第 4 节。用户已取消 Unity 日志删除/清空，本次未修改该模块；未打包、推送或发布新版。由 Codex 直接实施，未调用 WorkBuddy；积分未提供，无法确认。）

- 更新日期：2026-11-10（**TASK-032 太阳美化与地理纬线：代码、计算及浏览器验收完成**。暖色颗粒光球与柔和日冕，赤道/南北回归线及中文纬度标注，旋转/缩放与遮挡，简化视图同步保留。计算 **14/14**、隔离浏览器 **61/61**、前端构建通过；无新增依赖、素材或外部运行请求，证据见第 4 节。由 Codex 直接实施，未调用 WorkBuddy；积分未提供，无法确认。）

- 更新日期：2026-11-10（**TASK-031 写实三维地球：代码、计算及浏览器验收完成**。Globe.gl / Three.js、本地 4K 地表/夜景与 2K 云层、大气边缘、实时昼夜/直射点/射线、拖动/缩放/键盘及复位、失败降级/重试与资源释放。计算 **13/13**、隔离浏览器 **48/48**、最终前端构建通过，运行时外部请求为零。素材及三维依赖的署名/许可随构建分发；证据见第 4 节。）

- 更新日期：2026-11-10（**TASK-030 网页地球光照：代码及浏览器验收完成**。首页与工具箱新增入口，实时显示太阳直射点、昼夜、分界及射线，支持拖动/键盘/按钮旋转、复位和 30 秒刷新。前端计算测试 **10/10**、隔离浏览器 **26/26**、构建通过。未生成安装包、推送或发布新版；证据见第 4 节。）

- 更新日期：2026-11-06（**TASK-029 ADB 传送 APK 安装：代码与离线/浏览器验收完成**。选择电脑 APK 和在线设备，核对后传送并覆盖安装，支持上传进度、安装等待、结果、取消及失败重试。APK 单项 **12/12**、完整后端 **503/503**、安卓浏览器 **167/167**、前端构建通过。**真实手机安装未验证**；未打包、推送或发布新版，证据见第 4 节。）

- 更新日期：2026-11-06（**TASK-028 Windows 后台启动：代码与相关验收完成**。源码与发布启动入口共享后台服务脚本，成功后退出启动 CMD，失败保留摘要及日志，停止时按项目路径匹配。Windows 隔离启动验收 **13/13**、发布包运行时 **14/14**；实际打包入口生成段在临时包中执行后，内置 Node 22 + SQLite + 生产页面及停止流程通过。未操作真实项目服务，未重新生成正式安装包/ZIP，也未发布新版；证据见第 4 节。）

- 更新日期：2026-11-05（**v0.2.0 已正式发布**：用户已授权推送当前代码并发布正式新版，范围为源码关闭入口及 TASK-019～027。源码与锁文件版本统一为 `0.2.0`，四份发布文件已生成，源码与发布包的 46 个后端文件及清单哈希一致。最终后端 **491/491**、HOME **11/11**、安卓浏览器 **150/150**、发布包运行时 **14/14**、ZIP 隔离生产检查 **16/16**、生产页面 **53/53**、更新页面 **17/17**，前端构建和语法检查通过；真实手机/平板未验证。修正一条取消测试对 30ms 调度的依赖。安装包首次编译遭文件占用，重试同一暂存目录成功后完成原脚本清单生成与运行时自检。GitHub 正式 Release：[v0.2.0](https://github.com/GuiYe314/team-toolbox/releases/tag/v0.2.0)，提供安装包、便携包、SHA256 和 `manifest.json`；说明见 [v0.2.0](releases/v0.2.0.md)，证据见 [封版验收记录](acceptance/V0_2_0_RELEASE_2026-11-05.md)。）

- 更新日期：2026-11-05（**TASK-027 常用 ADB 精简与桌面应用选择：代码与离线/浏览器验收完成**。内置仅保留锁定程序、恢复桌面、IP、设备信息、内存与 CPU 六项，保留自定义命令；HOME 应用按当前用户查询、选择、确认及复查。完整后端 **491/491**、安卓浏览器 **150/150**、前端构建通过。**真实手机 HOME 切换与性能查询未验证**，证据见第 4 节。）

- 更新日期：2026-11-05（**TASK-026 自定义常用 ADB 命令：代码与离线/浏览器验收完成**。命令区增加添加/编辑弹窗、确认删除、机器配置持久化与强制确认执行，支持引号参数及版本冲突检查。完整后端 **480/480**、安卓浏览器 **132/132**、前端构建通过。**真实手机自定义命令未验证**，证据见第 4 节。）

- 更新日期：2026-11-05（**TASK-025 Unity 局域网设备日志：代码与离线/浏览器验收完成**。搜索同网段 Android/iPad 的专用日志服务，按固定编号识别，支持历史文件、堆栈筛选、复制、自动刷新、全文与 ZIP 下载。完整后端 **466/466**、前端构建、复用真实 C# 网络服务的隔离浏览器联调通过；Unity 独立 C# **19 组**通过，Editor 编译结束且当前捕获窗口无新错误。**真实 Android/iPad 未验证，设备需完整重打包**，证据见第 4 节。原 MVP 下一任务不变。）

- 更新日期：2026-11-05（**TASK-024 网页手机屏幕预览：代码与离线/浏览器验收完成**。明确选择在线设备后支持单次及 1/2/5 秒间隔连续刷新、停止保留、清空和放大；二进制截图有完整性与资源限制，生命周期变化时取消并释放图片。完整后端 **441/441**、安卓浏览器 **110/110**、前端构建通过。**真实手机画面和刷新速度未验证**，证据见第 4 节。）
- 更新日期：2026-11-05（**TASK-023 单应用选择、运行状态与专属日志：代码与离线/浏览器验收完成**。日志区增加指定应用、包名搜索、运行状态及主/子进程 PID；服务端按匹配进程筛选日志，采集中定期跟随退出与重启，切换应用停止旧采集。完整后端 **427/427**、安卓浏览器 **94/94**、前端构建通过。**真实手机应用及日志未验证**，证据见第 4 节。）
- 更新日期：2026-11-05（**TASK-022 安卓双栏、设置弹窗与设备日志：代码与离线/浏览器验收完成**。调试页和普通设置页复用 ADB 设置弹窗；左侧连接与设备列表、右侧常用命令与实时 Logcat，可独立滚动。日志支持主动开始/停止、筛选、清空及进程生命周期管理；下拉菜单适配明暗主题并修复主题切换时的瞬时低对比。完整后端 **415/415**、安卓浏览器 **84/84**、设置页更新回归 **17/17**、前端构建通过。**真实手机日志与连接未验证**，证据见第 4 节。）
- 更新日期：2026-11-05（**TASK-021 安卓帮助、设置与常用命令：代码与离线/浏览器验收完成**。说明默认收起，点击帮助弹出；ADB 配置移到设置页；增加 14 个指定设备的内置命令与结果展示，重启二次确认。完整后端 **403/403**、安卓浏览器 **59/59**、设置页更新回归 **17/17**、前端构建通过。**真实手机命令及扫码未验证**，证据见第 4 节。）
- 更新日期：2026-11-05（**TASK-020 ADB 文件夹搜索与二维码配对连接：代码与离线/浏览器验收完成**。输入文件夹后有界搜索 ADB，多个结果由用户选择；增加两分钟有效的 Android 原生二维码，扫码后自动发现、配对并连接同一手机，支持取消、过期和重试。完整后端 **394/394**、隔离浏览器 **38/38**、前端构建通过；**真实手机扫码未验证**，证据见第 4 节。）
- 更新日期：2026-11-05（**TASK-019 安卓无线调试连接管理：代码与离线/浏览器验收完成**。提供 ADB 配置、设备列表、mDNS 搜索、六位码配对、IPv4 连接和单台无线设备确认断开；本机访问约束、参数数组、配对码保护和异常恢复均有覆盖。Node v24.22.1 完整后端测试 **378/378**，前端构建通过，隔离浏览器 **24/24**。**真实手机连接、配对与断开未验证**；原生模块在系统 Node v24.19.0 的崩溃与复验记录见第 4 节。）
- 更新日期：2026-11-05（**源码版关闭入口**：新增根目录 `stop.bat` 与 `scripts/stop.ps1`，按本项目路径识别并关闭 `start.bat` 启动的后端、前端窗口及其进程树，支持绝对路径 Node 入口、`/nopause` 与重复关闭；同步更新启动提示和使用文档。**验证证据**：在独立临时项目目录下用原生 `cmd.exe` 和 Windows 自带 PowerShell 执行 BAT，19 项检查通过，覆盖中文及空格路径、两个服务及子进程退出、另一个项目保持运行、数据文件保留、重复关闭、绝对入口进程和缺少辅助脚本时返回非零退出码。本次只验证启停脚本，未重跑前后端业务回归；下一任务仍见第 3 节。）
- 更新日期：2026-10-27（**v0.1.2 已发布**：首个自带自动更新能力的版本。发布验证中真实触发 `apply` 时发现**致命缺陷**——生成的 `apply.cmd` 用 LF 换行且含 UTF-8 中文注释，cmd.exe 把命令行撕成碎片，换文件完全没发生；此前的沙箱验证因脚本自行做了 `\n → \r\n` 替换而掩盖了它。已修复为行数组 + `join('\r\n')` + 英文注释 + 写入前置 BOM，并新增 4 项测试钉住不变量（无裸 LF、除 `启动.cmd` 外纯 ASCII、关键步骤在场、无 `timeout /t`）。真实产物端到端复验：解压发布包 → 版本改回 0.1.1 → check/download/stage/apply 全链路 → 版本变 0.1.2、数据标记完好、pending 清除、`apply.log` 记录 start→success、换完目录正常服务。附带修掉发布包混入 `*.test.js`（本版起 0 个）与清单超时过紧（20s→30s）。后端 `npm test` 343/343、`verify-update` 17/17。**待 Codex 验收**）
- 更新日期：2026-10-27（**TASK-018 自动更新**（用户新增范围）：支持「检查更新 → 下载 → 校验 → 备份 → 安装 → 重启」，新版本起不来时**自动回滚**。更新源做成**可配置**（http(s) 地址或内网共享/本地目录），不绑定 GitHub —— 实测本仓库为私有，匿名访问返回 404，且未认证 API 限流 60 次/小时，无法作为唯一更新源。新增 `backend/src/version.js`（版本单点来源）、`update-source.js`、`updater.js`、`update-api.js`、`frontend/src/views/Settings.vue` 与 `/settings` 路由；打包脚本新增 `release/manifest.json` 产出并把 `-Version` 注入包内 `package.json`。**顺带修掉版本号漂移**：此前 `/api/health` 硬编码 0.1.0 而 package.json 已是 0.1.1，v0.1.1 的包对外自称 0.1.0 —— 而自动更新完全依赖版本比对。过程中发现并修掉三个真缺陷：发布包 zip 多一层目录导致「包结构不正确」、`timeout /t` 在无控制台环境下立刻返回导致**误回滚**、暂存目录被占用时整个解压失败。后端 `npm test` 339/339（新增 `updater.test.js` 26 项）、新增 `verify-update.mjs` 17/17、前端回归 426 项全绿；隔离沙箱实测换取文件与自动回滚两条路径（成功 6 秒 / 回滚 66 秒，用户数据均完好）。**待 Codex 验收**）
- 更新日期：2026-10-27（**TASK-017 资源集合（Packs）**（用户新增范围，来自竞品对标 Modelibr）：补资源库的交付能力 —— 此前只有 `asset_folders` 树状层级，一个资源只能待在一个位置，「这次展会要用的 12 个模型」这类跨目录临时编组只能靠复制文件或反复移动。新增迁移 `008_asset_collections.sql`（集合表 + 成员多对多表）、`asset-collection-store.js`、`/collections` 系列路由与 `GET /assets/:id/collections` 反向查询；新增集合列表页与详情页（`/assets/collections`、`/assets/collections/:id`）、资源页「集合」入口与批量「加入集合」。**核心语义：集合是视图不是容器** —— 删集合 / 移出集合都不删资源，界面弹窗对此有明确说明；软删资源自动离开集合、恢复后自动回来（无需维护成员关系）。顺带补上 FUNCTIONAL_SPEC 的文档缺口：资源管理子系统自 TASK-010 起从未登记特性条目，本次登记 F-AM-001 并如实注明「未完整覆盖」。后端 `npm test` 313/313（新增 `asset-collection.test.js` 13 项）、新增 `verify-asset-collections.mjs` 20/20、前端回归 409 项全绿。**待 Codex 验收**）
- 更新日期：2026-10-27（**TASK-016 文档回收站**（用户新增范围，来自功能调研建议）：修复数据保护缺口 —— 文档此前是**物理硬删**（`DELETE FROM documents`），且 `ON DELETE CASCADE` 会连带删掉整棵子树，误删一篇带子页的文档没有任何挽回手段；而资源侧从一开始就有完整回收站。现改为软删：新增迁移 `007_document_trash.sql`（`is_deleted`/`deleted_at`/`deleted_by`），`store.js` 增软删/恢复/永久删除/回收站列表，`api.js` 增 `GET /documents/trash`、`POST /documents/restore`、`POST /documents/purge?confirm=1`、`POST /documents/trash/empty?confirm=1`；新增前端回收站页 `KnowledgeTrash.vue`（`/kb/trash`）与知识库工具栏入口；删除确认文案改为「移入回收站」并说明可恢复。正常列表/详情/搜索/页面树/编辑全部排除已删。**过程中修掉三个真问题**：①永久删除时 `ON DELETE CASCADE` 会带走「已单独恢复正常」的子文档；②`changes` 不统计被 CASCADE 带走的行，导致「删了 1 个」实际删了 3 篇；③测试硬编码迁移文件列表（006/007 都漏过），改为自动扫描迁移目录。后端 `npm test` 300/300（新增 `document-trash.test.js` 12 项）、新增 `verify-document-trash.mjs` 26/26、前端回归 389 项全绿。**待 Codex 验收**）
- 更新日期：2026-10-26（**v0.1.1 已发布**：https://github.com/GuiYe314/team-toolbox/releases/tag/v0.1.1 ，非草稿非预发布，`latest` 指向 v0.1.1，三份资产远端 digest 与本地 SHA256 逐一一致。**修复发布包 ABI 不兼容缺陷**：v0.1.0 发布包在用户机器上装完起不来 —— `better-sqlite3` 原生二进制编译于构建机 Node 22（ABI 127），用户系统 Node 24（ABI 137）加载必然失败，报 "NODE_MODULE_VERSION 127 vs 137"。因官方预编译仅覆盖 v108/115/127/131（无 ABI 137），用户机器无法靠 `npm rebuild` 自愈（需 VS Build Tools）。修复：**发布包内自带 Node 运行时**（`runtime/node.exe` v22.22.2，Windows 版单文件自包含），启动脚本优先使用它，用户机器无需安装 Node；安装器的 Node 检查已移除（它挡不住真问题）；新增 `runtime/check.js` 启动前自检（ABI 不匹配时给可操作提示）与 `runtime/open-browser.js`（等就绪再开浏览器）。装依赖时用内置 Node 跑 npm，保证 ABI 同源。顺带修掉打包脚本 `Invoke-Native` 用 `$Args` 作参数名（PowerShell 自动变量）导致参数恒为空的真 bug。已覆盖安装到用户实际路径实测通过（系统 Node 24 在 PATH 下启动正常，5 端点全 200，浏览器渲染 OK、控制台 0 错误）。另修 `verify-search.mjs` 依赖他脚本残留数据的缺陷（改为自造自收）。后端 288/288、前端回归全绿、新增 `verify-release-runtime` 14/14。**待 Codex 验收**）
- 更新日期：2026-10-23（**TASK-015 文档引用资源库**（用户新增范围，来自功能调研建议 4）：打通知识库与资源库两个子系统。编辑器新增「插入资源」按钮与资源选择器（可搜索、缩略图预览），插入**标准 Markdown 图片语法** `![资源名](/api/assets/files/<id>/<kind>/auto)`；资源文件端点新增 `auto` 版本指针（有发布版用发布版，否则退回最新版，资源发布后文档引用自动跟进）；新增 `MarkdownBody.vue` 统一处理图片失效降级（显示 alt 文本 + 原因说明，替代浏览器原生破图）。后端 `npm test` 288/288（新增 `asset-reference.test.js` 9 项）、新增 `verify-asset-reference.mjs` 18/18、前端回归 360/360。**待 Codex 验收**）
- 更新日期：2026-10-23（**TASK-014 全文检索升级 FTS5**（用户新增范围，来自功能调研建议 2）：搜索从 `LIKE '%kw%'` 全表扫描改为 FTS5 + 自研分词（中文 2-gram、英文整词），实现中文子串匹配（搜「海昏」能命中标题为「10月」但正文含「海昏侯」的文档）与 BM25 相关性排序。新增 `backend/src/search-index.js`、`migrations/006_search_index.sql`、`search-index.test.js` 26 项、`verify-search.mjs` 11 项；后端 `npm test` 279/279、前端回归 342/342。**待 Codex 验收**）
- 更新日期：2026-10-23（**TASK-013 全量备份**（用户新增范围，来自功能调研建议 1）：修复数据保护漏洞 —— 此前 `/api/backup/export` 只导出文档数据，**资源文件与文档图片都不在备份里**，用户点「导出备份」以为数据安全了实际只保住文字。新增 `backend/src/full-backup.js` + `full-backup-restore.js`、`GET /api/backup/full-export` 与 `POST /api/backup/full-import`；知识库页备份菜单新增「全量备份（.zip）」并明示各格式范围；后端 `npm test` 253/253（新增 `full-backup.test.js` 7 项）、新增 `verify-full-backup.mjs` 16/16、前端回归 315/315；端到端实测：导出 127 条目包（7 文档 / 4 分类 / 6 标签 / 18 资源 / 42 文件 / 77 图片）→ 恢复到独立库后逐项一致、42 个资源文件全部落盘。**待 Codex 验收**）
- 更新日期：2026-10-23（**v0.1.0 首次正式发布已完成**：Release 已发布为 https://github.com/GuiYe314/team-toolbox/releases/tag/v0.1.0 ，非草稿非预发布，`latest` 指向 v0.1.0，三份资产远端字节与 SHA256 核对一致。：建立完整发布体系 —— 版本策略 `docs/VERSION_POLICY.md`、发布说明 `docs/releases/V0_1.0.0.md`、验收报告 `docs/acceptance/V0_1.0.0_RELEASE_2026-10-23.md`、打包脚本 `scripts/build_release.ps1`、安装包定义 `installer/team-toolbox.iss`；产出便携包 ZIP + 安装包 EXE + SHA256 校验清单三份资产；便携包在独立目录解压后实际启动验证通过。同时修掉 5 个真问题：后端不托管前端、`/assets` 路由与构建产物目录同名冲突致资源页 404、`DB_PATH` 环境变量完全失效、后端启动不自动迁移、缓存头正则写错。后端 `npm test` 246/246（新增 `db.test.js` 3 项）、前端回归 315/315）
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
| TASK-019 安卓无线调试连接管理 | **代码与离线/浏览器验收完成；真机未验证** | 用户确认的连接、配对和设备管理范围；新增 35 项离线测试，完整后端 378/378、隔离浏览器 24/24、构建通过，证据见第 4 节 |
| TASK-020 ADB 文件夹搜索与二维码配对连接 | **代码与离线/浏览器验收完成；真机未验证** | 文件夹自动搜索及多版本选择、原生扫码配对并自动连接、两分钟会话与取消清理；新增 16 项离线测试，完整后端 394/394、隔离浏览器 38/38、构建通过，证据见第 4 节 |
| TASK-021 安卓帮助、设置与常用命令 | **代码与离线/浏览器验收完成；真机未验证** | 帮助弹窗、设置页 ADB 配置和滚动、14 个常用命令与重启确认；新增 9 项离线测试，完整后端 403/403、安卓浏览器 59/59、设置页更新回归 17/17、构建通过，证据见第 4 节 |
| TASK-022 安卓双栏、设置弹窗与设备日志 | **代码与离线/浏览器验收完成；真机未验证** | 两个入口复用设置弹窗、双栏独立滚动、指定设备实时 Logcat 与筛选/停止/清空、明暗下拉配色；新增 12 项离线测试，完整后端 415/415、安卓浏览器 84/84、设置页更新回归 17/17、构建通过，证据见第 4 节 |
| TASK-023 单应用选择、运行状态与专属日志 | **代码与离线/浏览器验收完成；真机未验证** | 包名列表/搜索、主子进程 PID 与是否运行、应用日志隔离、退出等待/重启跟随/切换释放；新增 12 项离线测试，完整后端 427/427、安卓浏览器 94/94、构建通过，证据见第 4 节 |
| TASK-024 网页手机屏幕预览 | **代码与离线/浏览器验收完成；真机未验证** | 明确设备、单次/连续刷新、停止保留/清空/放大、二进制与 PNG 限制、生命周期取消与图片释放；新增 14 项离线测试，完整后端 441/441、安卓浏览器 110/110、构建通过，证据见第 4 节 |
| TASK-025 Unity 局域网设备日志 | **代码与离线/浏览器验收完成；真机未验证** | 有界发现、固定编号、短期票据、只读历史与下载、前后台和取消清理；新增 25 项 Node 测试，完整后端 466/466、前端构建与隔离 C# 浏览器联调通过，Unity 独立 19 组通过且 Editor 编译结束，证据见第 4 节 |
| TASK-026 自定义常用 ADB 命令 | **代码与离线/浏览器验收完成；真机未验证** | 添加/编辑弹窗、确认删除、原子持久化、引号参数、明确设备与版本确认；新增 14 项离线测试，完整后端 480/480、安卓浏览器 132/132、构建通过，证据见第 4 节 |
| TASK-027 常用 ADB 精简、桌面选择与使用快照 | **代码与离线/浏览器验收完成；真机未验证** | 六项内置、当前用户 HOME 候选/默认值、搜索选择/确认/设置后复查、IP/设备/内存/CPU 查询；新增 11 项 HOME 离线测试，完整后端 491/491、安卓浏览器 150/150、构建通过，证据见第 4 节 |
| TASK-028 Windows 启动成功后关闭 CMD | **代码与相关验收完成** | 共享后台启动、身份/端口/健康判定、失败日志与本轮清理、按项目停止；隔离启动 13/13、发布运行时 14/14、真实临时包启动/停止通过；未发布新版，证据见第 4 节 |
| TASK-029 ADB 传送 APK 并安装 | **代码与离线/浏览器验收完成；真机未验证** | 单包和明确设备选择、确认、流式上传、包结构校验、覆盖安装、进度/结果、取消/超时/临时清理；新增 12 组离线测试，完整后端 503/503、安卓浏览器 167/167、构建通过，证据见第 4 节 |
| TASK-030 网页地球光照 | **代码、计算测试与浏览器验收完成** | 独立前端工具，10/10 计算测试、26/26 隔离浏览器、构建通过；可旋转昼夜球面、直射点和太阳射线，不读取团队数据，证据见第 4 节 |
| TASK-031 写实三维地球 | **代码、计算测试与浏览器验收完成** | 写实昼夜/灯光/云层/大气、同一太阳方向、缩放与原交互、离线资源/许可、失败降级/重试和清理；计算 13/13、浏览器 48/48、最终构建通过，证据见第 4 节 |
| TASK-032 太阳美化与地理纬线 | **代码、计算测试与浏览器验收完成** | 程序光球/日冕、赤道和南北回归线、中文标注/图例/遮挡及 Canvas 降级；计算 14/14、浏览器 61/61、构建通过，证据见第 4 节 |
| TASK-033 同一 APK 安装到多台设备 | **代码与离线/浏览器验收完成；真机未验证** | 在线设备多选/全选、完整确认、一次上传/逐台安装及实时结果、部分失败继续/重选、取消/离页清理；APK 22/22、完整后端 513/513、安卓浏览器 187/187、构建通过，证据见第 4 节 |
| TASK-034 Yoinks / FreeLLMAPI / ArtCraft 接入 | **代码与隔离验收完成；真实上游未验证** | 三页与入口、视频分析/下载/保存/取消、实际 HTTP 模型/流式聊天、Key 隔离、提示词/原生确认启动；专项 28/28、后端 541/541、浏览器 44/44、构建通过，证据见第 4 节 |
| TASK-035 全工具局域网访问 | **代码、相关验收与当前实例切换完成；跨设备未实测** | 默认 Lan/可选 Local、真实网段与同源检查、代理及 WebSocket、远程说明/HTTP 复制、停止不影响构建；后端 554/554、代理 7/7、启动 15/15、私网安卓 187/187、集成 47/47、构建及实际 IP 检查通过 |
| TASK-036 GitHub 默认更新源 | **代码、验收和 v0.3.1 正式发布完成** | 默认项目 Releases、仓库转换、关闭/恢复、缓存隔离、更新专用代理及后台脚本修复；最终后端 582/582、更新专项 58/58、Node 22 代理 20/20、更新浏览器 28/28、隔离替换/回滚 20/20；四份远端文件/公开清单及当前 Lan 实例检查通过，证据见第 4 节与封版记录 |
| TASK-037 实时网速工具 | **代码、隔离浏览器及本机真实网卡验证完成** | 单张物理/虚拟网卡、上下行/换算/趋势/累计/平均/峰值、暂停清空与取消恢复；完整后端 609/609、前端计算 19/19、浏览器 30/30、生产构建、本机/实际私网新页面及 API 通过，证据见第 4 节；另一物理客户端未实测 |
| TASK-039 Unity persistentDataPath 文件 | **两产品代码与隔离验收完成；真机未验证** | 当前用户/已安装包、目录浏览/预览/下载、添加/确认替换、SHA256与冲突清理；当前完整后端624/624、安卓187/187、新面板24/24、构建通过，独立版见专属分支状态 |
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

**TASK-019 后续验证**：在具备 Android 11 及以上手机和 Platform-Tools 的电脑验证真实 mDNS 发现、配对、连接及单台设备断开。本次未连接硬件，也未增加 APK 安装、Logcat 或投屏范围。

**TASK-020 后续验证**：在上述真机环境验证从 Platform-Tools 或 SDK 父目录搜索 ADB，以及手机无线调试专用入口扫码后的原生配对、自动连接、取消和过期重建。当前离线执行器与真实浏览器结果不能替代手机及局域网 mDNS 验证。

**TASK-021 后续验证**：在真机上核对内置命令的设备兼容性，以及用户主动确认后的重启、重连行为；当前仅用离线执行器验证命令与目标，未操作真实手机。原 MVP 下一任务保持上述 TASK-010 与 TASK-009 剩余范围。

**TASK-022 后续验证**：在具备 Platform-Tools 和在线手机的本机验证持续 Logcat、中文/多行输出、长时间采集、断线重连和停止行为，并检查各厂商日志可见范围。当前仅验证离线流、真实 Node 子进程及浏览器，不替代手机实测。原 MVP 下一任务不变。

**TASK-023 后续验证**：在上述真机环境验证应用包名列表、长包名与子进程、打开/退出/重启后的状态与日志跟随，以及设备对 `ps -A -w -o PID,NAME` 的支持。检查短暂进程、特殊进程名、系统代写记录及进程号复用时的采样限制；当前离线 PID 变化不能替代硬件行为验证。原 MVP 下一任务不变。

**TASK-024 后续验证**：在上述真机环境验证屏幕画面、横竖屏旋转、受保护内容、不同厂商兼容性及真实无线刷新速度；核对断线、设备重启和恢复读取。当前生成 PNG 与浏览器生命周期验证不能替代真实手机截图。原 MVP 下一任务不变。

**TASK-025 后续验证**：完整重打 Android/iPad 包，在同一可互通局域网验证自动发现、IP 变化后重新识别、iOS 本地网络授权、前后台恢复、历史轮换和完整下载。不得用本机 C# 协议服务替代 IL2CPP 真机结论；大网段需核对搜索报告与指定 IP 补查。原 MVP 下一任务不变。

**TASK-026 后续验证**：在在线手机上核对用户自己的设备命令、应用包名与引号参数、厂商权限差异，以及自定义重启后的连接恢复。当前模拟执行器只能验证参数传递、设备范围和软件流程，不代表手机接受所有命令。原 MVP 下一任务不变。

**TASK-027 后续验证**：在在线 Android 手机上核对 HOME 候选、当前用户、默认程序设置及恢复桌面、系统按包名选择 HOME 入口的行为，检查不同厂商的命令权限与返回格式；核对全部 IPv4、设备属性与 dumpsys 内存/CPU 快照。此功能设置默认桌面，不实现禁退锁定；真实兼容性仍需手机验证。原 MVP 下一任务不变。

**TASK-028 后续交付**：源码与打包模板的相关验证完成；若需要分发这一改动，使用新补丁版本执行完整封版与发布流程，不覆盖已发布的 v0.2.0 文件。

**TASK-029 后续验证**：在已授权的在线 Android 手机上核对无线/USB 安装、同包名覆盖后的数据保留、签名不一致与版本降级提示、厂商安装确认，以及无线断线/取消后的手机最终状态。当前合成 APK 与离线 ADB 只验证工具箱流程，未操作真实手机；本地源码已更新，已发布 v0.2.0 不包含此功能，分发需另行生成新版本。原 MVP 下一任务不变。

**TASK-032 后续交付**：本次地球界面改动及相关验收完成，原 MVP 下一任务不变；本地源码与前端构建已更新，分发时另行生成新版本，本次未打包、推送或发布。

**TASK-033 后续验证与使用**：在至少两台已授权的在线手机上验证同一 APK 的无线/USB 混合安装、厂商确认、单台掉线/超时和失败重试，核对保留应用数据及取消后的最终状态。当前使用合成 APK、离线 ADB 和真实浏览器，未操作真实手机。源码版需重启工具箱后刷新页面，确保运行服务加载新增批量接口；已发布 v0.2.0 不包含此功能，分发需另行生成新版。原 MVP 下一任务保持 TASK-010 与 TASK-009 剩余范围。

**TASK-034 后续使用与验证**：源码版重启工具箱并刷新页面；配置 yt-dlp/ffmpeg、本机 FreeLLMAPI 地址及统一 Key、ArtCraft.exe。真实外站下载、供应商模型推理、ArtCraft 原生窗口和生成尚未验证；集成验收使用合成媒体、模拟模型服务及隔离启动器，不能当作真实上游验收。原 MVP 下一任务保持 TASK-010 与 TASK-009 剩余范围。

**TASK-035 后续使用与验证**：同网段电脑或手机使用启动器显示的服务器私网地址。当前实例已切换为 Lan，本机私网地址验证通过；另一物理客户端、真实设备及第三方程序仍需实际环境确认。路径和外部程序属于服务器，FreeLLMAPI 重启后需重填统一 Key。原 MVP 下一任务保持 TASK-010 与 TASK-009 剩余范围。

**TASK-036 后续使用与分发**：v0.3.1 已正式发布，当前 Lan 源码服务已加载本版，设置页检查 current/latest 均为 0.3.1。直接填写仓库 HTTPS 或 `.git` 地址即可转换；未来升级仍须同时发布新版 ZIP 与 `manifest.json`。旧版受代理或后台脚本缺陷影响时先完整备份、关闭服务并手动安装本版，保留 `data/`；v0.3.0 发布页已补警告且旧资产保留。原 MVP 下一任务保持 TASK-010 与 TASK-009 剩余范围。

**TASK-037 后续使用与分发**：在当前源码服务的“工具箱 → 实时网速”打开，或使用 `http://192.168.100.39:5173/tools/network-speed`。统计运行工具箱的 Windows 电脑，单张网卡包含局域网及互联网流量；不代表访问设备自身网速、单应用流量或宽带测速。本机物理/虚拟网卡和实际私网 IP 已验证，另一台物理设备访问及其他 Windows 版本未实测。本功能尚未汇入已发布 v0.3.1，分发时另行生成新版；原 MVP 下一任务保持 TASK-010 与 TASK-009 剩余范围。

## 4. 验证证据

**TASK-039 实际验证摘要（2026-11-12，Windows）**：

- **源码上传**：原工具箱文件功能提交3787948925f966f6babdb342b65f73c7e1a09762已推送main，提交仅含本轮21个文件，原实时网速改动仍未提交。独立版代码f247a0c5ccf1c35bd2bfbabbc4315af45c0d4cd8已上传codex/device-debugger及标签，Release ID442506551正式且非latest；四份远端资产大小/digest与公开清单匹配，主线latest再次核对仍为v0.3.1。发布结果补记不移动标签。

- **精确提交核对**：将暂存区导出到 build/ 下新建隔离目录，仅复用依赖、不含原网速模块，再运行该副本完整后端 **597/597、51 suites、0 fail/skip**，生产构建通过（14.07秒，仅既有大块体积提示）。验证后回收依赖junction及隔离目录，原工作树内容未变。证据：build/persistent-main-index-backend.log、persistent-main-index-build.log。
- 原工具箱使用 Node v24.22.1 按 backend/package.json 的完整测试列表执行，**624/624、51 suites、0 fail/skip**；frontend 计算测试 **19/19**、最终 Vite 构建通过。工作树包含原有未提交的实时网速功能，本轮不会将该模块混入文件管理提交。日志：build/persistent-backend-final.log、persistent-build-final.log。
- 新增 android-persistent.test.js **15/15**，覆盖参数/目录协议、在线与当前用户/已安装包、权限/符号链接、UTF-8 与二进制、大小上限、添加/确认替换、原文件冲突、失败/取消/退出/超时清理、API 同源边界；包含真实 Node 二进制子进程和 Git Bash 固定 POSIX 脚本执行，不是真实 ADB。
- 在实际私网地址执行原安卓浏览器 **187/187**、新文件面板 **24/24**，覆盖浏览/预览/完整下载、添加/替换/冲突重试、错误恢复、Android 用户切换/重新定位、后台/离页取消、明暗主题与布局。日志：build/persistent-android-regression.log、persistent-browser-final.log，截图为 build/persistent-light.png / persistent-dark.png。
- 原工具箱按 scripts/stop.ps1 的精确项目身份停止旧进程，再由 scripts/start-services.ps1 隐藏启动 Development/Lan；健康返回 team-toolbox-backend / 0.3.1 / db.ok=true。本机与192.168.100.39经5173代理调用新 list API 的无效请求均400，跨站403；实时网速页面200、受保护只读接口正常响应，数据文件保留。没有执行真实手机写入或主线更新 apply。
- 新模块与独立版保持相同源码；独立分支 codex/device-debugger 的后端 Node24/随包Node22各 **204/204**、安卓 **187/187**、新面板 **24/24**、Unity合成HTTP浏览器 **18/18**、LAN代理 **7/7**、Windows启停 **15/15**，便携包/安装器隔离 **30/30**。独立发行结果由该分支 PROJECT_STATUS 记录；主线 v0.3.1 资产和 latest 保持原样。
- 真机、厂商ADB权限和另一物理客户端未验证。仅标准Android/data/包名/files，不自动停止App/改权限；App并发改写无法锁定，建议先关闭App并下载备份。Codex 完成，未调用 WorkBuddy；积分未提供，无法确认。

**TASK-037 实际验证摘要（2026-11-11，Windows）**：

- **后端**：使用 Codex 捆绑 Node v24.22.1，在 backend 目录通过 npm-cli.js 执行 `npm test`，完整 **609/609、51 suites、0 fail/skip**。新增 `node --test backend/src/network-speed.test.js` 的 **27 项**覆盖真实间隔差值、uint64、中文分块、新卡/断网/复位/长间隔、共享/空闲/退出、采样时限及输出限制、失败重试和 Local/Lan/Host/同源/专用头/参数拒绝；使用模拟进程，不修改真实网络。日志：`build/network-speed-backend.log`、`build/network-speed-tests.log`。
- **计算与构建**：frontend 的 `npm test` 等价测试文件执行 **19/19**（原地球 14 + 网速 5），包含单位、无效值、跨轮询累计、基线/复位和真实时间分段曲线。最终 `node node_modules/vite/bin/vite.js build` 通过，15.90 秒，仅既有大块体积提示。日志：`build/network-speed-frontend-tests-final.log`、`build/network-speed-frontend-final-build.log`。受限环境 esbuild 读取上级目录被拒的原始输出保存在 `build/network-speed-sandbox-build.log`，在正常执行环境复验通过。
- **页面**：`node frontend/verify-network-speed.mjs` **30/30**；生产 dist、临时 Express、合成物理/VPN 网卡及临时 Chrome，覆盖两入口、默认网卡、双向读数/换算/曲线/累计、暂停/清空/切换、后台恢复、请求/采集失败、时间空档、移除/离线、在途取消/迟到、离页和不支持系统。1280/1600 明暗主题内部布局与下拉 4.5:1 对比度通过，目视截图；无未处理 JS 异常和外部请求。全局既有 1280px 最小内容宽加边距会超出 1280 视口，断言按该桌面约定及工具内部边界检查，未改变全局尺寸。受限环境浏览器调试曾超时，正常执行环境隔离复验通过。日志：`build/network-speed-browser-final.log`，截图：`build/network-speed-light.png` / `network-speed-dark.png`；结束回收临时服务与浏览器，不访问团队数据库。
- **真实网卡**：通过 `node build/network-speed-smoke.mjs` 只读连续采样，四张网卡中包含在线物理、断开物理、Tailscale 和 vEthernet；实际源间隔约 1.37 秒，断开网卡速度为 null。日志：`build/network-speed-real-smoke.log`；已 dispose，不下载测速文件或修改网络。
- **当前实例**：以 `scripts/stop.ps1 -ProjectRoot <本项目绝对路径>` 停止旧服务，再隐藏执行 `scripts/start-services.ps1 -Mode Development -AccessMode Lan -NoBrowser`，后端 PID `69900`、前端 PID `61232`。`2026-11-11T08:18:51.126Z` 执行 `node build/network-speed-live-check.mjs`，新 API 返回 ready、实际物理网卡两次采样间隔约 1.19 秒；本机和 `http://192.168.100.39:5173/tools/network-speed` 页面 200，经过 Vite 代理的同源快照均 ready，当前 Vue 源码模块 200。证据：`build/network-speed-live-stop.log`、`build/network-speed-live-start.log`、`build/network-speed-live-check.json` / `.log`；服务保留运行；结束观察后通过 CIM 核对后端下无 PowerShell 采集进程，两服务监听 0.0.0.0 且 PID 匹配，隔离浏览器剩余零个，证据 `build/network-speed-live-idle-check.log`。
- **范围**：无需新增依赖或 SQLite/机器配置迁移，计数和历史不持久化；没有抓包、外站测速、进程级归因、修改防火墙/网络、操作手机或供应商、执行真实更新 apply。本次更新本地源码与文档，没有提交、推送、生成新版或覆盖 v0.3.1 资产。Codex 完成，未调用 WorkBuddy；积分未提供，无法确认。


**v0.3.1 封版验证摘要（2026-11-11，Windows）**：

- 远端结果：`main` 与 `v0.3.1` 已推送，标签解析到 `e3ef19988b0b4373675611a765be5642bb6e5f22`；Release ID `441321583` 正式发布且为 latest。四份资产大小和 SHA256 digest 匹配本地；公开 `https://github.com/GuiYe314/team-toolbox/releases/latest/download/manifest.json` 实际下载后的 SHA256 为 `ad7a6230e3cbc96fd855d7063433bb97bd0e84a47ae3c38b44df1e38b63f5da5`，字节一致。证据：`build/v031-remote-published.json`、`build/v031-remote-latest.json`、`build/v031-public-latest-manifest.json`。草稿按标签查询返回 404 后通过发行列表定位原草稿 ID 再核对/发布，没有重复创建。
- 旧版提示：按 VERSION_POLICY 规则 11，在 v0.3.0 正文顶部加入明确缺陷、请勿下载及 v0.3.1 手动升级链接；原正文完整保留，四份旧资产的 ID、大小和 digest 不变。证据：`build/v031-old-release-before.json`、`build/v031-old-release-after.json`。
- 当前实例：按项目绝对路径停止旧服务，再通过 `scripts/start-services.ps1` 隐藏启动 Development/Lan，后端 PID `69996`、前端 PID `62804`。`2026-11-11T06:49:53.2499050Z` 核对健康版本 0.3.1，真实项目 GitHub 检查 current/latest 均为 0.3.1、hasUpdate=false、busy=null；本机和 `http://192.168.100.39:5173/settings` 均 HTTP 200。证据：`build/v031-live-stop.log`、`build/v031-live-start.log`、`build/v031-live-check-final.json`、`build/v031-live-pages-final.json`。仅检查清单，没有在真实项目调用 apply。
- 最终完整后端 **582/582，51 suites，0 fail/skip**；更新专项 **58/58**，Node 22 代理专项 **20/20**，生产构建通过。最终 ZIP 的运行时 **14/14**、实际 CMD Local/Lan 启停和生产 API **34/34**、通用页面 **53/53**、隔离更新设置 **28/28**、真实替换及注入启动失败回滚 **20/20**。最终日志、资产大小和哈希见 [封版记录](acceptance/V0_3_1_RELEASE_2026-11-11.md)。
- 原 v0.3.0 独立副本的后台 apply 实测未完成，修复脚本编码、管道等待和 CMD 重启后，用最终 v0.3.1 代码加旧版本标识的全新副本验证成功/回滚；不宣称未经修改的 v0.3.0 更新器通过。中文、空格、感叹号路径及合成文档/文件/配置保留均已覆盖，副本服务已停止，真实项目未执行 apply。
- 54 个后端文件、153 个前端产物哈希一致；ZIP 4489 条、空数据目录，Undici 及许可随包。Inno 临时文件占用重试和后端随机禁止端口重跑均留存原始失败日志，最终均通过。待提交路径检查与凭据模式扫描通过，构建、依赖和真实运行数据未入库。Codex 完成，未调用 WorkBuddy；积分未提供，无法确认。

**TASK-036 实际验证摘要（2026-11-11，Windows）**：

- 更新专项：使用 Codex 捆绑 Node v24.22.1 执行 `node --test backend/src/update-http.test.js backend/src/updater.test.js`，**57/57** 通过。新增真实本地 CONNECT 代理验证清单与 ZIP 共用代理、重定向回环直连、全局 dispatcher/fetch 隔离、完整响应超时、长度/流量限制、SHA256 及断流/失败文件清理；配置测试覆盖默认源、旧配置、显式关闭、URL 转换、优先级与缓存隔离。日志：本机 `build/github-update-proxy-tests.log`。
- 完整后端：在 backend 目录将该 Node 路径置于当前子进程 PATH 首位，使用 npm-cli.js 执行 `npm test`，**581/581、51 suites、0 fail/skip**。日志：`build/github-update-backend-final.log`。
- 发布运行时兼容：使用 `build/runtime-cache/22.22.2/node-v22.22.2-win-x64/node.exe --test backend/src/update-http.test.js`，**20/20** 通过；只使用临时目录与本地代理，未运行真实安装。日志：`build/github-update-node22-proxy.log`。
- 前端生产构建：在 frontend 目录以捆绑 Node 执行 `node node_modules/vite/bin/vite.js build` 成功，18.63 秒；保留既有大块体积提示，无构建失败。日志：`build/github-update-frontend-final.log`。
- 更新界面：执行 `node frontend/verify-update-isolated.mjs`，**28/28** 通过、控制台无错误；隔离临时数据库/配置/浏览器，阻断服务端上游访问和 download/stage/apply，结束清理。日志：`build/github-update-browser-final.log`。此结果不等同于真实安装或回滚验收。
- 实际网络：初次 Node 直连 GitHub 清单连接超时；只读确认 Windows 手动代理开启，PowerShell 经系统代理读取成功。增加更新专用 Undici 6.29.1 dispatcher 后，按绝对项目路径停止并隐藏重启 Lan 服务，后端 PID 25868、前端 PID 52596。`POST http://127.0.0.1:3000/api/update/check` 于 `2026-11-11T04:25:54.769Z` 成功，current/latest 均为 **0.3.0**、hasUpdate=false、无错误，源为 `https://github.com/GuiYe314/team-toolbox/releases/latest/download`；随后状态缓存一致、busy=null。本机和 `http://192.168.100.39:5173/settings` 均 HTTP 200。证据：`build/github-update-live-stop.log`、`build/github-update-live-start-final.log`、`build/github-update-live-check-final.json`、`build/github-update-live-pages-final.json`。
- 范围：只保存用户要求的真实更新源、检查公开清单及按项目身份重启；未下载或安装真实更新、修改防火墙/系统代理、操作手机/供应商、提交、推送、打包或发布。全部证据文件在忽略目录，仅保存在本机。Codex 完成，未调用 WorkBuddy；积分未提供，无法确认。


**TASK-035 实际验证摘要（2026-11-10，Windows）**：

- **网络与后端**：新增 `tool-access.test.js` **13/13**，覆盖 Local/Lan、实际掩码（含 /23）、私网范围、映射 IPv4、非法 Host/Origin、转发头、各模块 JSON/专用头及仅 APK 二进制例外，使用实际私网 TCP 请求调用三组路由。`backend` 用现有 Node v24.22.1 执行 `npm test`，**554 tests / 49 suites / 0 fail / 0 skipped**，日志 `build/lan-backend-tests.log`。初次回归发现旧模拟请求只经 `req.get` 提供 Origin，修正共用读取后完整复验通过，保留原有拒绝用例。
- **开发代理**：`node scripts/verify-lan-access.mjs` **7/7**，使用实际 Vite 配置、自定义后端端口及临时无数据库服务。覆盖私网页面与模块、ADB/Unity POST、保留 LAN Host、跨站/伪造头拒绝、WebSocket 升级前拒绝、代理前真实来源校验与误绑定的 Local 拒绝。日志 `build/lan-proxy-tests.log`。
- **Windows 启停**：`node scripts/verify-startup.mjs` **15/15**，结束清理成功；临时中文/空格/特殊字符目录，验证 Lan 地址及 CLI/环境、Local、源码/发布两入口的 `/local`、自定义端口、占用拒绝、健康失败清理、日志轮换及项目隔离。实际切换与构建并行时发现停止脚本把 Vite build 当作服务，已收紧识别并增加“保留同目录 Vite build”的真实进程检查，最终构建重跑通过。日志 `build/lan-startup-tests.log`。
- **页面与构建**：最终 `frontend` 的 `npm run build` 通过，仅既有分块提示，日志 `build/lan-frontend-build.log`。设置 `TT_VERIFY_LAN=1` 运行 `node frontend/verify-android-wireless.mjs` **187/187** 和 `node frontend/verify-integrations.mjs` **47/47**；真实临时 Chrome 通过私网 IP 访问，覆盖设备/配对/多台安装/屏幕/日志及三个集成、取消和主题。集成最终构建另验证远程管理链接隐藏、真实非安全 HTTP 上下文、用户点击的实际 `execCommand` 复制及 DOM/焦点恢复。日志 `build/lan-android-browser.log`、`build/lan-integrations-browser.log`；均使用临时配置/离线设备/模拟模型，不操作真实手机或团队数据。
- **当前实例**：按绝对项目入口核对并停止原回环服务，以共享脚本 `-Mode Development -AccessMode Lan -NoBrowser` 重启。后端 TCP 3000、前端 TCP 5173 均为 `0.0.0.0`；从本机物理私网 IP 访问首页、安卓/Unity 页面、health 与 ADB/三个集成只读配置均 **200**，数据库就绪。Unity 对不存在会话的同源请求返回业务 **400**，缺少专用头与跨站请求均 **403**，未发起设备发现或真实日志读取；后端同源静态首页也 **200**。最后用系统网络权限再次检查页面/health 成功，两个服务保留运行；沙箱内一次连接被拒不能当作服务已停止。
- **范围**：没有修改网络类别、防火墙或公网映射；另一台物理电脑/手机访问、真实 ADB/Unity 硬件与 FreeLLMAPI/ArtCraft/外站下载本轮未实测。Unity 服务逻辑和客户端未改，本轮未重跑此前的 C# 跨语言浏览器联调；验证新增访问边界和页面兼容。没有更改 SQLite 结构或团队内容、读取真实 Key，也未推送/打包/发布。

**TASK-034 实际验证摘要（2026-11-10，Windows）**：

- `node --test src/integrations.test.js`（backend）：**28 tests / 0 fail**。临时配置原子合并/损坏保护、路径和回环地址、真实无 Shell 参数及进程超时/在途取消/输出限制；离线 yt-dlp 探测/格式/MP3/临时文件/领取/清理/过期/失败；模型 Key 不落盘/切换地址清除、分块 UTF-8 SSE、历史/大小限制、坏流/未完成/供应商过滤、401/429、取消/超时；ArtCraft 确认/固定路径/冷却/缺失/启动失败及 API 来源/附件/NDJSON/脱敏日志。
- 使用与既有 SQLite 原生模块匹配的 **Node v24.22.1** 临时加入当前命令 PATH 后，在 backend 执行 `npm test`：**49 suites / 541 tests / 0 fail**，日志 `build/integrations-backend-tests.log`。无新增 npm 依赖或 SQLite 迁移；新增机器配置只在临时目录测试。
- frontend 的 `npm run build` 最终通过，日志 `build/integrations-frontend-build.log`；保留既有大型分块提示，无编译错误。初次沙箱构建因 esbuild `spawn EPERM` 失败，授权运行后构建通过。
- `node frontend/verify-integrations.mjs`：**44/44**，日志 `build/integrations-browser-tests.log`。真实 Chrome、临时配置/合成媒体、独立回环 FreeLLMAPI 模拟服务验证三项入口、缺少组件、检测保存、视频格式/进度/真实文件保存/失败/取消/离页、Key 内存及不回显、真实 HTTP 模型/聊天/多轮、纯文本防执行、停止/失败片段隔离、清空后迟到结果、额度错误、提示词/复制/路径/确认/冷却、body Teleport/焦点/Escape、明暗及 1280 布局。脚本异常 **0**，浏览器外部服务/CDN 请求 **0**。
- 桌面技能 `tcode-computer-use` 实际调用返回 `spawn EPERM`，依其失败回退规则使用上述隔离浏览器。六张截图位于忽略的 `build/integrations-{yoinks,chat,artcraft}-{light,dark}.png`；已目视检查聊天浅色与下载深色。验收发现新页面 content-box 溢出，改为局部 border-box 后最终布局通过。未读写团队数据库或访问真实 Key/应用，临时服务、浏览器、媒体和配置在结束时清理。
- 已同步 README、规格与特性覆盖、计划、架构、用户指南、AGENTS、CHANGELOG 及上游许可说明；检查 `git diff --check` 与新增文件尾随空白通过。前序启动器、APK、地球等未提交工作保留。本轮未提交、推送、打包或发布。

**TASK-033 实际验证摘要（2026-11-10，Windows）**：

- `node --test src/android-apk.test.js`（backend）：**22 tests / 0 fail**，日志 `build/apk-batch-unit.log`。保留原单台 12 项，新增 10 项覆盖 1～20 台/重复/确认/字段校验、目标快照、同一临时包/顺序单并发、逐台实时事件、部分失败/掉线/错误成功输出、独立超时后继续、上传取消/超时、用户取消/服务退出不执行后续、锁释放、伪装/截断包拒绝、批量本机 HTTP 边界、NDJSON 汇总和流断开回收。
- 使用 **Node v24.22.1** 按 `backend/package.json` 的 `scripts.test` 清单执行完整后端测试：**49 suites / 513 tests / 0 fail**，日志 `build/apk-batch-backend-test.log`。沿用系统 Node v24.19.0 的原生模块兼容性记录；本次无新依赖、SQLite 或机器配置结构迁移。
- `npm.cmd run build`（frontend）最终通过，日志 `build/apk-batch-frontend-build.log`；只有既有大型分块提示。前端 XHR 结果上限按最多 20 台的逐台事件、汇总及 JSON 转义有界设置，不把上传进度当安装成功。
- `node frontend/verify-android-wireless.mjs`：**187/187**，日志 `build/apk-batch-browser.log`，在原 167 项上增加 20 项。真实无头 Chrome + 临时配置 + 离线执行器验证多选/全选/取消全选、完整目标确认、修改目标重确认、安装中锁定与逐台实时状态、一次上传共用临时包、两台成功、部分失败及离线后继续、只选失败设备重新确认、取消保留已成功项/停止后续、离页清理、返回重置、帮助及 1280×760 明暗布局；原连接、HOME、自定义命令、设备/应用日志及屏幕回归全部通过，浏览器脚本错误 **0**。
- 已目视检查 `build/android-apk-batch-light.png` 与 `build/android-apk-batch-dark.png`，多选目标、序列号、按钮和汇总文字清晰、无横向溢出，长内容由右栏独立滚动。桌面技能返回 `spawn EPERM`，按技能允许的失败回退使用现有隔离 CDP 脚本；首轮验收将模型名误按原始下划线断言，按既有解析显示的空格修正后完整通过。
- 验证未读取真实 ADB 配置、手机或团队数据库，临时浏览器/配置/APK 目录已回收；截图、日志与构建产物被 Git 忽略。用户取消的 Unity 日志删除/清空没有实施。本次只更新本地源码与构建，未生成正式包、推送或发布新版。
- 收尾检查：`git diff --check`、六个相关 JavaScript 文件的 `node --check` 和相关源码尾随空白检查通过；核对源码、测试、规格、计划、帮助、指南及维护约束一致，保留已有启动脚本、APK 单台和地球功能的未提交修改。
- 模型执行：**Codex 直接实现及验收，未调用 WorkBuddy；积分未提供，无法确认**。下一任务、源码版重启及真机范围见第 3 节。

**TASK-032 实际验证摘要（2026-11-10，Windows）**：

- `npm test`（frontend）：**14 tests / 0 fail**，日志 `build/solar-guides-tests.log`。保留原 13 项计算回归，增加赤道/南北回归线的纬度、闭合及单位球面验证。
- `npm run build`（frontend）通过，日志 `build/solar-guides-build.log`。无新增依赖、贴图或数据结构，沿用三维延迟加载；仍有既有大型分块提示。
- `node frontend/verify-earth-sunlight.mjs`：**61/61**，日志 `build/solar-guides-browser.log`。原 48 项回归保留，新增三条中文纬度标注、实际青色/紫色 WebGL 像素、太阳标注及日冕说明、旋转后的标签位置与遮挡、复位恢复、背面太阳标签隐藏、明暗主题 **1280/1440/1920** 下标签在画布内，以及 Canvas 降级纬线像素与图例。
- 浏览器运行异常 **0**、外部运行请求 **0**；静置无常驻动画，离页释放 WebGL 上下文、位图及绘制帧。验收继续使用临时静态服务、空只读文档接口与隔离浏览器，不访问真实团队数据。
- 目视检查 `build/earth-sunlight-light.png`、`build/earth-sunlight-dark.png` 和 `build/earth-sunlight-fallback.png`：暖色光球、柔和日冕、三条纬线、中文标注和图例清晰；默认视角太阳与地球有间距，降级保留改进后的太阳及三线。太阳表面与日冕明确为示意。
- `solar-sun.js`、`solar-globe-3d.js`、`solar-globe.js`、`solar-geometry.js` 及 `verify-earth-sunlight.mjs` 的 `node --check` 通过。只修改前端地球功能及说明，未重跑无关后端或 WPF 回归。
- 文档收尾后 `git diff --check` 通过，新增地球文件未发现尾随空白；开发服务 `/src/utils/solar-sun.js` 返回 **HTTP 200** 且包含新太阳模块，可刷新现有地球页查看。
- 模型执行：**Codex 直接实现及验收，未调用 WorkBuddy；积分未提供，无法确认**。下一任务及分发范围见第 3 节。

**TASK-031 实际验证摘要（2026-11-10，Windows）**：

- `npm test`（frontend）：**13 tests / 0 fail**，日志 `build/solar-3d-tests.log`。保留十项太阳近似计算回归，新增地理轴/世界向量与光照余弦一致、分界大圆闭合及正交、透视可见范围及缩放三项；不依赖联网或团队数据。
- `npm run build`（frontend）最终构建通过，日志 `build/solar-3d-build.log`。Globe.gl **2.46.2**、Three.js **0.183.2** 固定版本并更新锁文件；沿用已有 Three.js 版本、各组件共用一个依赖实例，三维代码在进入工具时延迟加载。新三维分块仍有大于 500 kB 的提示，不宣称零体积开销；本地三张贴图合计约 **2.23 MB**，许可文本 `/earth-notices.txt` 随构建输出。
- `node frontend/verify-earth-sunlight.mjs`：**48/48**，日志 `build/solar-3d-browser.log`。真实无头 Chrome / WebGL 验证实际纹理像素、三张本地贴图和署名、入口/太阳坐标、按钮/真实拖动/方向键/复位、真实滚轮/加号/按钮缩放及边界、手动/30 秒刷新、后台暂停/恢复、背面提示；明暗主题下 **1280/1440/1920** 均无横向溢出且调整尺寸后仍有球面画面。
- 额外覆盖 HTTP 503 贴图失败后的 Canvas 降级/交互、重试仅保留一个有效 WebGL 上下文和三张位图、真实上下文中断、WebGL 不可用、静置无常驻动画帧、加载中离页取消与迟到结果不回填；离页后上下文已释放、位图和绘制帧为零。浏览器运行异常 **0**、外部运行请求 **0**。验收使用临时静态服务、空只读文档接口和临时浏览器，不启动真实后端或读写团队数据。
- 目视检查 `build/earth-sunlight-light.png`、`build/earth-sunlight-dark.png` 和 `build/earth-sunlight-fallback.png`：地表、夜间灯光、云层、边缘大气、分界及射线正常，降级保留原图和可见提示。计算中使用可控时钟检查时间变化；图片仅为验收证据，云层/灯光均明确为静态素材。
- 开发服务的 `/src/utils/solar-globe-3d.js`、Globe.gl 与 Three.js 优化模块实际返回 **HTTP 200**；新依赖可在当前 `127.0.0.1:5173` 使用。三个地球相关 JavaScript 文件的 `node --check` 和 `git diff --check` 通过，素材 SHA-256 与来源说明一致。
- 首轮浏览器检查发现调用了 Globe.gl 未暴露的 `showNavInfo` 方法，已移除该调用并在配置前保存场景实例，最终完整浏览器验收通过；加载失败不再遗留场景。桌面技能仍返回 `spawn EPERM`，按技能允许的失败回退使用隔离浏览器脚本；Node 子进程检查通过环境提权执行。只验证本次前端功能，不重跑无关后端或 WPF 回归。
- 模型执行：**Codex 直接实现及验收，未调用 WorkBuddy；积分未提供，无法确认**。原 MVP 下一任务仍见第 3 节；本地源码及前端构建已更新，本次未打包、推送或发布新版。

**TASK-030 实际验证摘要（2026-11-10，Windows）**：

- `npm test`（frontend）：**10 tests / 0 fail**。覆盖 2024 春分/秋分及南北至日、UTC 06/12/18 经度方向、同一时刻的时区等价、闰日/年界、经度归一化及非法日期、向西运动、太阳点积与两极季节昼夜、球面投影/逆投影及经纬度文字。
- `npm run build`（frontend）通过；保留既有大型分块提示。新增工具路由独立分块，不引入依赖和后端接口。
- `node frontend/verify-earth-sunlight.mjs`：**26/26**。真实无头 Chrome 加载本地构建产物，覆盖工具卡片与首页入口、Canvas 像素、坐标/当前时间、按钮/真实鼠标拖动/键盘旋转及复位、手动更新、30 秒定时回调（可控时钟）、后台暂停与恢复、背面标记提示、离页回收及 1280/1440/1920 明暗主题下无横向溢出。浏览器运行错误为 0、外部网络请求为 0。
- 明暗截图 `build/earth-sunlight-light.png` 和 `build/earth-sunlight-dark.png` 已目视检查。隔离服务只提供构建产物和空只读文档列表，临时浏览器目录已回收，未访问团队数据库。桌面技能返回 `spawn EPERM`，改用隔离 CDP 浏览器验证；构建和测试首次受相同子进程权限阻挡，经授权范围内的环境提权后成功。
- 模型执行：本次由 Codex 直接实现及验收，未调用 WorkBuddy；积分未提供，无法确认。下一任务仍为第 3 节原有 MVP 验收；分发新增工具须另行生成新版，当前没有打包、推送或发布。

**TASK-029 实际验证摘要（2026-11-06，Windows）**：

- `node --test src/android-apk.test.js`（backend）：**12/12**。覆盖请求头/确认/文件名与大小、在线设备前后复核、固定 `-s <serial> install -r` 参数、完整与伪装/截断 APK、超限/少传、成功与失败输出识别、取消/独占锁释放、服务退出、两阶段超时，以及本机 HTTP 限制和连接中断清理。使用合成 ZIP 与临时文件，不调用真实 ADB。
- 使用 **Node v24.22.1** 执行 backend 的 `npm.cmd test`：**49 suites / 503 tests / 0 fail**。日志：`build/apk-backend-tests.log`。无新依赖、SQLite 或机器配置结构迁移；沿用既有系统 Node v24.19.0 原生模块的兼容性记录。
- `npm.cmd run build`（frontend）通过，只有既有大分块提示。日志：`build/apk-frontend-build.log`。
- 使用 Node v24.22.1 执行 `frontend/verify-android-wireless.mjs`：**167/167**，新增 17 项 APK 交互断言。真实无头浏览器配合离线执行器，覆盖文件/目标选择、确认与取消、上传及等待状态、安装成功、输出纯文本展示、失败重试、伪装包拒绝、操作取消、离页回收与返回后文件重置；回归已有连接配对、HOME 与自定义命令、设备/应用日志、屏幕、双栏及明暗主题对比度。浏览器脚本错误为 0，日志：`build/apk-android-ui.log`。
- 验证使用独立临时配置与 APK 目录，脚本结束后清理；未读取真实手机或团队数据库，APK、日志与构建产物不入库。帮助、用户指南、规格、计划与架构同步更新。**真机安装未验证；本次未生成正式发布包、未推送或创建 Release。**
- 收尾检查：六个相关 JavaScript 文件的 `node --check` 通过，`git diff --check` 通过，六个新增文件无尾随空白；未覆盖上一项启动脚本改动。

**TASK-028 实际验证摘要（2026-11-06，Windows PowerShell 5.1）**：

- `node scripts/verify-startup.mjs`：**13/13**。实际运行使用 Node `v24.22.1`，只创建临时项目与随机回环端口。覆盖源码双服务、发布单服务、延迟就绪、启动器退出后持续运行及继续写 stdout/stderr、日志轮换、占用端口拒绝、不同项目隔离、停止与失败时的辅助子进程回收、进程立即退出、不监听超时、HTTP 503、非法健康 JSON、错误服务标识及数据库未就绪；同时执行源码和发布 CMD 入口，覆盖中文/空格/`! & ()` 路径、PATH 中多套 Node、包内运行时优先、缺少辅助脚本的非零退出码。临时服务均已回收。
- 将现有发布暂存目录的 `backend`、`frontend` 与 `runtime` 复制到全新 `build/startup-smoke-<随机值>/team-toolbox`，不复制 `data`；执行本次 `build_release.ps1` 中实际的启动/停止入口生成段。`PKG_DIR=<临时包> node frontend/verify-release-runtime.mjs`：**14/14**，内置 Node `v22.22.2`（ABI 127）加载 SQLite 成功，系统 Node 24（ABI 137）给出预期兼容性提示。
- 对该临时包的实际 `启动.cmd /nopause` 设置随机 `PORT`、独立 `DB_PATH` 与 `TT_SKIP_BROWSER=1`：启动 CMD 返回 0 后，`GET /api/health` 确认数据库就绪且路径位于临时包，`GET /` 返回 200 并包含生产页面。随后使用包内 `scripts/stop.ps1` 关闭服务，确认监听已消失，重复停止成功；临时包已清理。
- PowerShell AST 检查 `start-services.ps1`、`stop.ps1`、`build_release.ps1`，以及 Node 对验收脚本的语法检查通过。修正验证中发现的多套 Node 路径选择及带特殊字符目录的 CMD 提示；未更改业务 API、前端组件或数据结构，因此未重复运行无关模块整套回归。
- **发布范围**：本次更新源码、打包模板及文档，未重打正式 ZIP/安装包、未推送或创建新 Release；GitHub 已发布的 v0.2.0 文件保持原样。下一步若发布补丁，应使用新版本并执行封版门槛。

**TASK-027 实际验证摘要（2026-11-05，Windows）**：

- 新增 `android-home.test.js` **11 项**，单项 **11/11**，日志：`build/android-home-unit.log`。覆盖组件规范化/去重/注入拒绝、明确在线授权设备、当前 Android 用户、HOME Intent 与固定参数、无候选/无默认值、严格确认、用户变化/候选失效、设置后默认包复查、恢复桌面、同包不同入口、错误/复查失败、数量/输出边界、取消/总时限及本机 HTTP 字段约束。既有九项命令测试改为六项目录与查询快照，并回归自定义、日志和屏幕与自定义重启的交互。
- 使用 **Node v24.22.1** 执行 `backend/package.json` 的全部 `scripts.test` 文件，**49 suites / 491 tests / 0 fail**，安卓相关离线测试合计 **123 项**。日志：`build/android-home-backend.log`。无新依赖、SQLite 或机器配置结构迁移；延续既有系统 Node v24.19.0 的原生模块说明。
- `npm.cmd run build`（frontend）通过，**1446 modules transformed**；仅既有大分块提示。日志：`build/android-home-build.log`。
- 通过 Node v24.22.1 执行 `frontend/verify-android-wireless.mjs`，最终 **150/150**：真实无头 Chrome、临时配置、离线 ADB。验证六项目录、中文设备属性/全部 IPv4/内存和 CPU 快照、HOME 用户/候选/当前值、包名搜索、未选择禁用、确认与取消、规范参数、设置后显示与恢复桌面、用户变化和应用失效拒绝、读取失败重试、搜索/命令/设备切换清空、确认按钮完整可见，以及 HOME 下拉明暗对比度至少 4.5:1；回归自定义增改删/持久化/版本冲突、配对连接、设备/应用日志、屏幕及双栏/设置弹窗。浏览器脚本错误为 0，日志：`build/android-home-browser.log`。
- 已目视检查 `build/android-home-confirm.png`、`build/android-home-light.png` 和 `build/android-home-dark.png`，程序选择、当前值、命令预览及确认按钮可读，无横向溢出。`git diff --check` 与八个相关 JavaScript 文件的语法检查通过。日志、截图及构建产物被 Git 忽略，隔离临时目录已清理；未读取本机真实 ADB 配置或团队数据库。
- **未验证**：真实手机默认 HOME 修改/恢复、厂商权限及设备信息/性能返回值。未操作真实 ADB，未打包、发布或推送；本轮未重跑其他模块浏览器或 Unity Editor，既有验证范围不变。

**TASK-026 实际验证摘要（2026-11-05，Windows）**：

- 新增 `android-custom-commands.test.js` **14 项**，安卓相关离线测试合计 **112 项**。覆盖单双引号/空参数/反斜杠解析、ADB 前缀/全局目标/连接命令/拼接拒绝、远端参数字面量转义、首次空库/增改删/服务重建读取、原子保存与临时文件清理、字段/重复名称/数量限制、损坏配置拒绝覆盖、内置保护、版本冲突、明确在线且已授权设备、每次布尔确认、失败/取消恢复和原文/输出不入日志。HTTP 验证本机来源/Host/JSON/专用头/额外参数约束；Host 检查使用原生 HTTP 请求。与既有内置命令合跑 **23/23**，日志：`build/android-custom-unit.log`。
- 通过现有 **Node v24.22.1** 执行 `backend/package.json` 中 `scripts.test` 的全部文件，**49 suites / 480 tests / 0 fail**。日志：`build/android-custom-backend.log`。新增机器配置 `data/android-commands.json` 版本 1，不改变 SQLite 或依赖；延续先前系统 Node v24.19.0 的原生模块版本说明。
- 最终 `npm.cmd run build`（frontend）通过，**1444 modules transformed**，仅既有大分块提示。日志：`build/android-custom-build.log`。
- 通过 Node v24.22.1 执行 `frontend/verify-android-wireless.mjs`，最终 **132/132**：真实无头 Chrome、临时配置及离线 ADB。新增覆盖帮助说明、添加弹窗 Teleport/居中/遮罩、焦点环绕/Escape 恢复、小窗口滚动、错误保留草稿、分类及自动选择、保存不执行、强制确认/取消、带空格参数、编辑与放弃、刷新后保留、并发修改拒绝旧预览/重新读取、删除确认及明暗主题弹窗；同时回归原连接、配对、内置命令、屏幕、设备/应用日志、设置与双栏。浏览器脚本错误为 0，日志：`build/android-custom-browser.log`。
- 已目视检查 `build/android-custom-editor.png` 和 `build/android-custom-editor-light.png` / `build/android-custom-editor-dark.png`，表单、文字、预览和操作可读且未溢出。执行 `git diff --check` 及七个相关 JavaScript 文件的语法检查通过。验证使用临时机器配置与离线执行器，临时目录已清理；未读写真实团队数据库或 ADB 配置，日志、截图和构建产物不入 Git。
- **未验证**：真实手机命令执行、厂商权限及重启行为。未操作真实 ADB，未打包、发布或推送；本轮未重跑其他模块的浏览器脚本或 Unity Editor，既有记录保持原验证范围。

**TASK-025 实际验证摘要（2026-11-05，Windows）**：

- **完整后端**：在 `backend` 使用本机 Node v24.22.1 执行 `npm test`，**466 tests / 49 suites / 0 fail**；本次三份 Unity 日志测试新增 25 项，覆盖掩码/私网候选/大网段限制、协议与稳定编号、超时/取消/重定向/响应大小、历史与下载、票据刷新与设备变更、本机 API 保护及取消连接后会话回收。输出保存在本机被忽略的 `build/unity-log-backend.log`。系统 Node 的旧 SQLite 原生问题沿用此前记录，未升级依赖。
- **构建**：`frontend` 的 `npm.cmd run build` 通过，1442 modules transformed；保留原有大分块提示，无本次构建错误。
- **Unity**：`Assets/Test/Log/Tests~` 的独立 C# 测试 19 组通过，含来源绑定票据、到期/容量/撤销及 HTTP 历史读取。脚本导入后 DIYUnityCLI 返回 ready、compiling=false、playMode=stopped；当前 domain 捕获会话 `652851ac5b7b4affb81a2e72d4f0ea74` entries 为空（不代表历史 Console）。实际查询 HotUpdate 中 `StartupLogManager.settings.autoStartWebAccess=true`、webPort=17523、closeWebOnPause=true，浏览器 TextAsset 引用有效。场景原有未保存状态保留，未进入 Play、未保存场景或改写预制体。
- **跨语言浏览器联调**：临时 C# 服务直接引用修改后的 `Runtime/Network/*.cs`，只提供合成设备与日志；临时 Node 服务使用真实发现/代理模块和构建产物，扫描限定电脑本身一个地址，不扫描真实手机、不接入团队数据库。浏览器实际验证初始状态、1/1 地址搜索、选择与三份历史文件、中文堆栈/等级/关键词、复制、全文和 ZIP 下载、历史切换、大文件尾部与 1000 条显示上限；失败时保留内容并显示异常、下载失败恢复按钮、搜索取消与空结果、恢复读取、离页关闭。离页后服务统计 closes 从 1 增至 2。含 HTML 的日志按纯文本呈现，日志容器无 script 元素。
- **下载证据与界面**：下载原件 279 字节，ZIP 7903 字节，可读取元数据及三份日志（含 534078 字节原件）；界面截图保存在本机 `C:/Users/GY/Documents/Codex/Artifacts/UnityLogTool_20261105/unity-logs-dark.png`，展示标为“隔离验证设备”的合成内容。临时两个服务已停止，未将合成数据写入真实设备或团队库。
- **未验证**：真实 Android/iPad 的局域网互通、本地网络权限、前后台恢复、IL2CPP 和完整包安装；没有生成或发布 APK/iOS/网页发布包。跨语言联调不是手机实测；网页其他模块的浏览器脚本本轮未重跑。

**TASK-024 实际验证摘要（2026-11-05，Windows）**：

- 新增 `android-screen.test.js` **14 项**，安卓相关离线测试合计 **98 项**。覆盖 PNG 签名/块边界/CRC/结束块与尺寸限制、原始字节无损读取、明确在线且已授权设备及固定参数、禁用 Shell/隐藏窗口、12 秒总时限、输出上限、取消与单在途限制、失败记录与恢复、本机 API/请求头/额外参数拒绝、不缓存 PNG 响应、配置变化/对应设备断开和重启取消，以及与普通命令并行。用真实 Node 子进程验证二进制读取，未使用 ADB。单项日志：`build/android-screen-unit.log`。
- 通过现有 **Node v24.22.1** 执行 `backend/package.json` 中 `scripts.test` 的全部文件，**49 suites / 441 tests / 0 fail**。日志：`build/android-screen-backend.log`。不改变依赖或持久化结构，沿用先前系统 Node v24.19.0 的原生模块版本说明。
- `npm.cmd run build`（frontend）通过，**1438 modules transformed**，仅既有大分块提示。日志：`build/android-screen-build.log`。
- `node frontend/verify-android-wireless.mjs` **110/110**：真实无头 Chrome 与隔离 HTTP 服务，截图为生成的 240×480 PNG，ADB 使用离线执行器。新增覆盖默认不读取/明确设备、真实图片尺寸、固定参数、body Teleport/遮罩/居中/Escape/焦点恢复、替换和清空时释放 Blob URL、连续刷新不重叠、停止无后续请求且保留画面、无效图片/失败/重试、换设备取消在途读取、设备消失、后台停止、保存配置及离页取消清理；同时回归连接、二维码、六位码、命令、应用日志、设置与明暗主题及小窗口。浏览器脚本错误为 0。日志：`build/android-screen-browser.log`。
- 已目视检查 `build/android-screen-preview.png` 与 `build/android-screen-enlarged.png`，预览纵向适配、放大弹窗居中、配色和操作可读。两张均为生成的测试图，非真实手机画面。临时配置与浏览器目录已清理，未读取机器 ADB 配置或团队数据库；日志、截图和构建产物不入 Git。
- **未验证**：真实手机截图、受保护内容、旋转、设备兼容性及无线刷新速度。未操作真实 ADB，未打包、发布或推送；本轮未重跑无关模块的浏览器脚本，既有证据保持原验证范围。

**TASK-023 实际验证摘要（2026-11-05，Windows）**：

- 新增 `android-apps.test.js` **8 项**及 `android-logcat.test.js` **4 项**，安卓相关离线测试合计 **84 项**。覆盖包名与设备校验、列表去重/排序/数量上限、主进程与冒号子进程/相似前缀排除/长包名、只读参数与超时/取消传递、未安装/未运行/未授权/错误恢复、API 本机来源/请求头/额外参数拒绝；应用日志只缓存匹配 PID、未启动等待、新 PID 跟随、旧 PID 排除、退出状态、重复状态查询合并、停止取消在途查询及错误后结束进程。
- 通过现有 **Node v24.22.1** 执行 `backend/package.json` 中 `scripts.test` 的全部文件，**49 suites / 427 tests / 0 fail**。日志：`build/android-apps-backend.log`。不改变依赖或数据结构，延续先前 Node 原生模块版本说明。
- `npm.cmd run build`（frontend）通过，**1436 modules transformed**，仅既有大分块提示。日志：`build/android-apps-build.log`。
- `node frontend/verify-android-wireless.mjs` **94/94**：真实无头 Chrome 与隔离 HTTP 服务，应用、进程及 ADB 使用离线执行器。新增覆盖指定应用模式/选择前禁用、包名搜索、运行状态与主/子 PID、子进程日志及其他进程排除、退出等待、重启后新 PID/旧 PID 排除、切换应用停止旧进程和清空、未运行应用等待启动、应用读取失败与重试。原二维码、六位码、设备管理、命令、设备日志、两个设置入口、1280×760 独立滚动和明暗对比度回归全部通过，浏览器脚本错误为 0。日志：`build/android-apps-browser.log`。
- 已目视检查 `build/android-app-logcat.png` 的选择、运行状态与日志区。应用列表和运行状态为内存快照；临时配置/浏览器目录已清理，未读取机器 ADB 配置或团队数据库。日志、截图和构建产物不入 Git。
- **未验证**：真实手机包管理、应用进程变化、各厂商命令支持及日志完整性；尤其不能把进程存在视为前台/健康状态，也不能保证捕获短于采样间隔的进程、非包名前缀进程或系统代写的记录。未操作真实 ADB、未打包/发布/推送；本轮未重跑无关模块及设置更新专门脚本，TASK-022 的 17/17 记录保持原验证范围。

**TASK-022 实际验证摘要（2026-11-05，Windows）**：

- 新增 `android-logcat.test.js` **12 项**，安卓相关离线测试合计 **72 项**。覆盖固定参数与明确在线/授权设备、分段 UTF-8 和 CRLF、threadtime 解析、增量游标、数量/字节缓存限制、过长输出停止、日志正文不入操作日志、停止/替换/对应设备/销毁、15 秒心跳超时、启动与退出错误、配置变化、与普通命令并行，以及本机 API/请求头/参数边界。真实 Node 子进程持续输出及停止也有测试，不使用 ADB。
- 使用现有 **Node v24.22.1** 执行 `backend/package.json` 的 `scripts.test` 全部测试文件，**49 suites / 415 tests / 0 fail**。日志：`build/android-logcat-backend.log`；沿用先前 Node 版本说明，没有变更依赖或 SQLite 结构。
- `npm.cmd run build`（frontend）通过，**1434 modules transformed**，仅既有大分块提示。日志：`build/android-logcat-build.log`。
- `node frontend/verify-android-wireless.mjs` **84/84**：真实无头 Chrome、隔离 HTTP 服务、临时配置、离线 ADB 与日志流。覆盖调试页与普通设置页弹窗/不跳转/保存/关闭/焦点恢复、1280×760 双栏与独立滚动、实时日志/HTML 文本显示/级别与关键词/清空后续收/停止保留/失败重试/退出提示/换设备/设备消失/修改配置/离页释放，以及明暗下拉文字和选项对比度至少 4.5:1；同时回归二维码、六位码、单设备断开及常用命令。浏览器脚本错误为 0，未读取机器 ADB 配置或团队数据库。
- 首轮浏览器检查发现主题切换时文字立即换色而输入框背景仍在渐变，造成短暂低对比；已对安卓下拉框取消背景渐变，让文字与实底同步更新。修复后重建并通过明暗主题的即时对比度检查。已目视检查 `build/android-settings.png`、`build/android-logcat.png` 和 `build/android-wireless-light.png` / `build/android-wireless-dark.png`。
- 通过既有隔离启动器 `build/verify-settings-update.mjs` 执行 `frontend/verify-update.mjs`，**17/17**；使用临时数据库及更新目录，下载/暂存/安装接口被阻止，没有安装更新。日志：`build/android-logcat-settings-update.log`。安卓浏览器日志：`build/android-logcat-browser.log`；测试结束清理临时目录，所有日志/截图/构建产物不入 Git。
- **未验证**：真实手机 Logcat、扫码、连接、命令及各厂商兼容性。未连接真实 ADB，未打包、发布或推送；无关模块整套浏览器验收未重跑。

**TASK-021 实际验证摘要（2026-11-05，Windows）**：

- 新增 `android-adb-commands.test.js` **9 项**，安卓相关离线测试合计 **60 项**。覆盖目录及参数不可被调用者改写、全部 14 个命令的明确设备参数、输出返回、命令/序列号注入拒绝、在线/授权状态复核、严格布尔重启确认、失败日志与锁释放、超时/输出限制/取消，以及本机 HTTP 边界和额外参数拒绝。
- 通过现有 **Node v24.22.1** 执行 `backend/package.json` 的 `scripts.test` 全部测试文件，**49 suites / 403 tests / 0 fail**。日志：`build/android-commands-backend.log`；沿用先前 Node 版本说明，未改变依赖或数据结构。
- `npm.cmd run build`（frontend）通过，**1429 modules transformed**，仅既有大分块提示。日志：`build/android-commands-build.log`。
- `node frontend/verify-android-wireless.mjs` **59/59**：默认不显示说明及 ADB 选择、点击帮助才弹出、body Teleport/全屏遮罩/居中、Escape 焦点恢复、较小窗口正文滚动、设置跳转及配置/清除/多候选/刷新、设置页可滚动至自动更新区、14 个命令及主动目标选择、输出 HTML 作为文本、失败重试、重启取消及确认、目标掉线拒绝和列表移除后清空目标；同时回归二维码、六位码、单设备断开与明暗主题。真实无头 Chrome、隔离 HTTP 服务、离线 ADB；浏览器脚本错误为 0。
- 在临时更新目录、临时数据库路径和隔离 Express 服务中执行既有 `frontend/verify-update.mjs`，**17/17**。覆盖未配置、已最新、有新版本、清单损坏及保存更新源；下载、暂存、安装等接口由隔离启动器阻止，未更新程序。运行后清理临时配置、清单与浏览器目录。日志：`build/android-settings-update.log`。
- 浏览器日志：`build/android-commands-browser.log`；已目视检查 `build/android-help.png`、`build/android-settings.png`、`build/android-commands.png`，帮助与结果可读，设置页布局与滚动已复验。所有测试数据、日志和截图均未纳入 Git。
- **未验证**：真实手机扫码或执行 ADB 命令、不同厂商设备兼容性与重启后连接。未连接真实 ADB，也未打包、发布或推送；无关模块的整套浏览器验收未重跑。

**TASK-020 实际验证摘要（2026-11-05，Windows）**：

- 新增 `android-adb-search.test.js` **6 项**与 `android-qr.test.js` **10 项**离线测试，安卓相关合计 **51 项**。覆盖有界文件夹扫描、路径/候选校验、搜索失败保留配置、随机二维码格式、严格匹配会话服务、stdin 口令及脱敏、扫码后自动连接、连接服务歧义、自动连接识别、过期、取消和失败恢复；未调用真实 ADB。
- 使用现有 **Node v24.22.1** 执行 `backend/package.json` 的 `scripts.test` 全部测试文件，**49 suites / 394 tests / 0 fail**。日志：`build/android-folder-qr-backend.log`。沿用 TASK-019 对系统 Node v24.19.0 原生模块崩溃的处理，不修改无关 SQLite 代码或依赖。
- `npm.cmd run build`（frontend）通过，**1423 modules transformed**，仅保留既有大分块提示。日志：`build/android-folder-qr-build.log`。
- `node frontend/verify-android-wireless.mjs` **38/38**：真实无头 Chrome 加载构建产物与隔离 Express 服务，ADB 使用离线执行器。覆盖空目录、多版本候选、父目录自动搜索、实际路径、二维码 SVG 与专用扫码指引、会话期间其他操作禁用、无口令持久化、取消、模拟扫码后的自动配对连接、过期重建、错误重试、导航取消、六位码备用流程、单台设备断开、刷新配置、表格滚动和明暗主题；浏览器脚本错误为 0。临时配置及浏览器目录已清理，未读取真实 ADB 配置或团队数据库。
- 浏览器日志：`build/android-folder-qr-browser.log`；截图：`build/android-wireless-qr.png`、`build/android-wireless-light.png`、`build/android-wireless-dark.png`。二维码截图已目视检查，采用四模块静区和不透明白底；日志与截图不入 Git。
- **未验证**：真实手机扫码、Android 系统配对交互、路由器 mDNS 可达性及真实 ADB 连接。未重新执行其他模块的整套浏览器验收，也未打包、发布或推送。

**TASK-019 实际验证摘要（2026-11-05，Windows）**：

- `node --test src/android-adb.test.js`（backend）**35/35**：设备与 mDNS 解析、路径/地址/六位码校验、配置持久化与环境变量优先、配对码标准输入及脱敏、单台设备隔离、刷新部分失败、并发释放、真实 Node 子进程的超时/取消/输出上限/Unicode 解码及 HTTP 访问边界。
- 完整后端使用现有 **Node v24.22.1** 执行 `backend/package.json` 中 `scripts.test` 的全部测试文件，**49 suites / 378 tests / 0 fail**。日志：`build/android-backend-tests-node24.22.log`。系统 Node v24.19.0 的 `npm test` 出现 `RemoveEnvironmentCleanupHook` 原生崩溃，涉及既有 `asset-store`、`search-index` 和 `store` 测试；沙箱外仍可复现，换用现有 v24.22.1 后全部通过，未修改 SQLite 代码或依赖来规避。
- `npm run build`（frontend）通过；仅保留既有大分块提示。日志：`build/android-frontend-build.log`。
- `node frontend/verify-android-wireless.mjs` **24/24**：真实无头 Chrome 加载构建产物和隔离 HTTP 服务，ADB 使用注入的离线执行器。覆盖工具入口、配置、未授权/离线设备、无效地址、mDNS、六位密码框、提交即清空、配对后重搜、连接后刷新、断开确认/取消、失败重试、空状态、刷新配置、表格滚动及明暗主题无横向溢出；浏览器脚本错误为 0。最终测试完整清理其临时配置和浏览器目录，未修改团队数据库。
- 浏览器日志 `build/android-browser-checks.log`，明暗主题截图 `build/android-wireless-light.png` / `build/android-wireless-dark.png`，已目视检查页面布局；日志与截图不入 Git。
- **未验证**：真实 ADB 与手机、路由器 mDNS 可达性、Android 授权及硬件配对/连接/断开。本次没有执行真实设备操作，也没有重新跑其他功能的整套浏览器脚本。

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
| 无认证部署于内网 | 误暴露公网导致数据公开可写 | F-OPS-001/005 边界；Local 仅回环、Lan 校验实际网段/服务器 Host/同源；前端代理前校验；禁止公网映射 |
| 保存冲突体验差 | 并发编辑时误覆盖他人修改 | 乐观版本 + 409 + 人工两选项；实时协同已列延期规划 |
| 备份依赖手动 | 数据丢失风险 | TASK-009 已提供页面内导出/导入按钮（快照格式可移植、导入幂等），仍缺定时备份脚本；自动化列入待决策 |
| Vue SFC 解析器限制 | `<script>` 块中含字面量 `</script>` 会让构建失败 | 已在脚手架文档与代码风格上规避；本任务已实测不含该字面量的完整构建 |
| API 尚未被前端消费 | TASK-003 接口未接入 UI，无法验证端到端真实路径 | 待 TASK-005 接入；接口层已用自动化测试 + curl 联调覆盖 |
| 单人推进 | 知识与进度集中 | 决策与状态全部文档化，CHANGELOG 追加留痕 |

## 6. 更新纪律

每完成一个任务：更新第 2 节状态、第 3 节下一任务、第 4 节追加验证证据，并在 [CHANGELOG](../CHANGELOG.md) 追加条目；禁止把计划写成实现，禁止无证据的“已通过”。
