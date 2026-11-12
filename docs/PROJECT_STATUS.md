# 设备调试工具项目状态（唯一状态源）

## device-debugger-v0.2.1 正式发布（2026-11-12）

**源码上传及正式发布完成**：[device-debugger-v0.2.1](https://github.com/GuiYe314/team-toolbox/releases/tag/device-debugger-v0.2.1)，Release ID **442865585**，非草稿、非预发布。本产品明确latest=false，主工具箱latest最终为v0.5.0。发行源码/标签为 **6f388554d7e3e74c542b5ed012095bf7ae32cec9**，已推送codex/device-debugger；本条结果另作文档提交，不移动发布标签，不重建已验收资产。

- 两产品各四份远端资产的名称、大小、uploaded状态和GitHub SHA256 digest逐项与最终本地文件一致；匿名下载精确标签的device-debugger-manifest.json，**1202字节**，SHA256为`5389ca71b352175721a2671948d605fb9d588d29b41a219332aaeefd23bf98e4`，与本地逐字节一致。最终资产和验收范围见[封版记录](acceptance/DEVICE_DEBUGGER_V0_2_1_2026-11-12.md)；证据：build/v021-release-draft.json、v021-release-published.json、v021-public-manifest.json。
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

## TASK-042 多 APK 安装队列（2026-11-12）

**两产品实现、最终构建和隔离验收完成，已纳入本轮发布文件。** 面板支持选择1～20个完整APK及1～20台设备；多文件时最多两台并行，每台按文件顺序安装，逐项反馈并精确重试失败的设备与文件组合。每包1GiB、整批4GiB，保留确认覆盖、取消及临时清理；不改变配置格式。

- 本产品完整后端 **223/223**，最终生产构建通过；原工具箱完整后端 **652/652（51 suites）**、前端计算 **19/19**，随包Node22.22.2的安装/包名/多APK专项 **41/41**。证据：本地build/v020-backend-queue-final.log及原工具箱相应v040日志。
- 两套多APK浏览器各 **23/23**、原安卓各 **187/187**、Unity文件各 **24/24**、包名各 **18/18**；本产品导航/设置发布链接/合成Unity **19/19**。无浏览器异常，明暗截图已目视。日志：build/final-verify-android-*.log、final-verify-device-debugger.log。
- 最终ZIP/安装器隔离验收 **36/36**、真实TCP保护 **7/7**、Windows启停 **15/15**。包含真实解压、源码哈希、双Node依赖、Local/Lan生产启动、两模块及新API边界、安装/卸载保留data，未改变原工具箱实例。日志：build/v020-release-final2.log、final-verify-lan-access.log、final-verify-startup.log。多APK仅使用离线ADB和合成APK，真实手机未验收。


## v0.2.0 封版（2026-11-12）

**正式发布完成**：[设备调试工具v0.2.0](https://github.com/GuiYe314/team-toolbox/releases/tag/device-debugger-v0.2.0)，Release ID **442766336**，非草稿、非预发布，明确设置非latest。范围为TASK-040及TASK-042；源码及两锁文件统一0.2.0，codex/device-debugger与新发布标签已推送，发行源码为 **a3d453b235154fb793f4fe585b0326c79ade8578**。结果另作文档提交，不移动已发布标签。

- 四份远端资产名称、大小、uploaded状态及SHA256 digest全部与最终本地文件一致；实际匿名下载精确标签下的device-debugger-manifest.json，1202字节，SHA256为`d2731a2513b9bc15d599aeb6abd76dd7050a89e26379c0b34a615bfdf63bd816`，与本地一致。证据：build/v020-release-draft.json、v020-release-published.json、v020-public-manifest.json，验收与四文件完整摘要见[封版记录](acceptance/DEVICE_DEBUGGER_V0_2_0_2026-11-12.md)。后续文档补记未重新构建二进制，也未覆盖旧资产。
- 本产品发布后先确认主线latest仍为v0.3.1；之后[完整工具箱v0.4.0](https://github.com/GuiYe314/team-toolbox/releases/tag/v0.4.0)正式发布并设置latest，ID **442766220**，主线发布源码 **0195eaeadd3db79803a45c736fdb0bd7fbad6d0a**。其manifest.json保持独立，本产品不提供该清单或主线自动更新器。
- 当前独立源码服务已按项目身份隐藏启动为Release/Lan **3100**，健康自报device-debugger/0.2.0；原工具箱Development/Lan **3000/5173**自报0.4.0且数据库正常。本机与192.168.100.39的健康、安卓深链和新端点空无效请求400、缺少专用头/跨站403，两产品共 **20/20**。本地证据：build/v020-live-restart.log；综合冒烟日志位于原工具箱build/v040-v020-live-final.log。未发送APK或调用真实ADB，两产品配置未互相复制。

下一步：刷新3100的安卓调试页，在安装面板多选APK和单/多台设备，核对后确认；分发使用本产品0.2.0安装包或ZIP。真机扫码、安装、文件权限及另一物理客户端仍未验收，取消不能回滚已完成安装；当前仍手动升级，不与主工具箱互换程序目录。

Codex 完成，未调用 WorkBuddy；积分未提供，无法确认。

## TASK-040 查看 APK 包名（2026-11-12）

**两产品源码、构建及当前本地服务验证完成。** 安卓调试右侧增加“查看 APK 包名”，选择单个 APK、主动读取并复制；无需 ADB、SDK 或手机。支持 UTF-8/UTF-16 编译清单、有界流式上传、完整性检查、取消及临时清理，没有新增依赖或持久化结构。

- 本产品完整后端 **213/213**、随包Node22.22.2新增专项 **9/9**，最终生产构建通过。原工具箱完整后端 **633/633（51 suites）**、前端计算 **19/19**及生产构建通过。日志：build/apk-info-backend.log、apk-info-node22.log、apk-info-build-final.log；原工具箱同名日志及apk-info-frontend-tests.log。
- 两套实际私网地址的新增浏览器各 **18/18**、原安卓各 **187/187**、Unity文件面板各 **24/24**；独立导航/合成Unity日志 **18/18**、真实TCP代理 **7/7**、Windows启停 **15/15**。覆盖无ADB读取、复制/失败恢复、换文件/清空、坏包拒绝、取消/后台/离页，以及原安装/文件/日志/截图；无浏览器异常。日志：build/apk-info-browser.log、apk-info-android-regression.log、apk-info-persistent-regression.log、apk-info-unity-browser.log、apk-info-lan.log、apk-info-startup.log。两产品apk-info-light.png / apk-info-dark.png已目视检查。
- 只读核对公开 [Appium ApiDemos v6.0.18](https://github.com/appium/android-apidemos/releases/tag/v6.0.18) APK，大小6521217字节，SHA256 `a9eecf37b26cd084855c530db81c2bb1b91f4c1b095a04f47aa7c20e2791f686` 与GitHub发布摘要一致；解析 `io.appium.android.apis`，与同标签app/build.gradle的applicationId一致，没有安装或执行APK。
- 按绝对项目身份停止并隐藏启动，独立版 Release/Lan **3100**、原工具箱 Development/Lan **3000/5173**。本机及192.168.100.39的页面/健康、真实APK读取、坏包400、跨站/缺少专用头403、附加参数400及临时目录回收共 **30/30**；日志：build/apk-info-live-smoke.log。两套ADB配置保持独立，验证未调用ADB或访问手机。
- 本轮未提交、推送、重新打包或发布；已发布device-debugger-v0.1.0资产不含本次修改，完整工具箱latest及资产未变。原工具箱原有未提交网速功能保持原地，运行数据、测试APK、日志、截图和构建产物不入库。

本任务下一步：刷新当前3100端口的安卓调试页即可使用；需要分发时另行生成新版。只读真实APK及隔离浏览器验收不代表手机安装验收，另一物理客户端未实测。以下TASK-038/039保留既有发行记录。

Codex 完成，未调用 WorkBuddy；积分未提供，无法确认。

- 2026-11-12 / TASK-039：两产品代码、构建、后端与隔离浏览器验收完成。支持当前 Android 用户的 Unity 标准外部目录浏览、文本预览、下载、添加与确认替换；原文件变化检测、传送 SHA256 校验与取消清理已验证。真实手机和厂商权限兼容性未验收。

## TASK-038（2026-11-12）

**独立正式发布完成**：[设备调试工具 v0.1.0](https://github.com/GuiYe314/team-toolbox/releases/tag/device-debugger-v0.1.0)，Release ID 442506551，非草稿、非预发布，明确 make_latest=false。发布源码、远端分支及标签均为 f247a0c5ccf1c35bd2bfbabbc4315af45c0d4cd8；本条结果另作文档提交，不移动发布标签。

基于主线 df1c7da 建立 codex/device-debugger 分支，只保留安卓调试、Unity 设备日志与设置；生产端口3100、开发5174、独立安装身份和 data/，不含 SQLite、其他工具或主线更新器。完整工具箱的原有未提交网速改动保留。

## 验证证据

- backend 完整离线测试 **204/204**，分别使用 Node v24.22.1 和随包 Node v22.22.2 执行；其中 android-persistent.test.js **15/15**，包含真实二进制子进程及 Git Bash 固定 POSIX 脚本执行。日志：本地 build/device-backend.log、device-node22-backend.log。
- 最终 frontend 生产构建通过；实际私网地址的安卓原功能浏览器 **187/187**、新文件面板 **24/24**。覆盖预览/下载、添加、替换/冲突、权限失败恢复、取消/后台/离页、Android 用户切换、明暗布局。日志：build/device-build-final.log、device-android-regression.log、persistent-browser-final.log。
- 独立导航/设置及 Unity 合成 HTTP 浏览器 **18/18**，真实 TCP 开发代理 **7/7**，Windows 启停 **15/15**；全部使用临时配置、离线 ADB 或合成日志，未访问真实手机。日志：build/device-unity-browser.log、device-lan.log、device-startup.log。
- 便携包与安装器隔离验收 **30/30**：全新目录解压、白名单与逐项哈希、双 Node 依赖加载、Local/Lan 中文 CMD 生产启停、深链、两模块 API/跨站拒绝、实际私网 IP、隔离安装/卸载及保留 data。原工具箱3000实例身份与健康保持。日志：build/device-release-verification.log。
- 原工具箱同步完整后端 **624/624**、前端计算 **19/19**、安卓浏览器 **187/187**、新面板 **24/24** 和生产构建通过；2026-11-12 已按项目路径隐藏重启，本机与实际私网接口已生效，同源无效请求400、跨站403、健康含数据库正常。原实时网速页面与只读接口保留。
- 原工具箱排除未提交网速模块后的精确暂存源码，在新建隔离副本中完整后端 **597/597**、生产构建通过；工作树未改动，临时junction与副本已清理。该功能单独提交到main，不将其他工具裁剪同步回主线。
- 原工具箱功能提交3787948925f966f6babdb342b65f73c7e1a09762已推送main，21个文件仅含本轮功能/测试/文档；原实时网速改动仍未提交。远端main和独立标签均已读取核对。
- 资产 SHA256、大小和执行范围见[独立封版验收记录](acceptance/DEVICE_DEBUGGER_V0_1_0_2026-11-12.md)。build/、release/ 与运行数据均不进入源码提交。
- 远端四份资产的名称、大小、uploaded状态与 SHA256 digest 逐项匹配本地；公开精确标签的清单实际下载后字节一致，SHA256为9a1b9de69b30796c85cdc3af1897bbdca894025e615814b3158107762ff429d7。再次读取主线 releases/latest 仍为 v0.3.1；没有修改其manifest或资产。证据：build/device-release-draft.json、device-release-published.json、device-main-latest.json、device-public-manifest.json。
- 当前独立源码目录已由start-services.ps1以Release/Lan隐藏启动，3100提供生产页面，本机与192.168.100.39的安卓深链200、新文件接口无效请求400，健康为device-debugger/0.1.0。原工具箱3000数据库健康、5173开发页面同时保持运行；独立ADB配置未从原工具箱自动复制。

## 下一步

用户可下载独立安装版或便携版，或使用当前3100端口，在安卓调试打开“Unity 替换 persistentDataPath 中文件”。真实手机/平板、另一物理客户端、厂商文件权限及 App 并发写入仍需实际环境验证；独立版当前手动下载安装更新。主线源码已同步，原网速改动继续保留。

Codex 完成，未调用 WorkBuddy；积分未提供，无法确认。
