# 设备调试工具项目状态（唯一状态源）

## TASK-042 多 APK 安装队列（2026-11-12）

**两产品实现、最终构建和隔离验收完成，已纳入本轮发布文件。** 面板支持选择1～20个完整APK及1～20台设备；多文件时最多两台并行，每台按文件顺序安装，逐项反馈并精确重试失败的设备与文件组合。每包1GiB、整批4GiB，保留确认覆盖、取消及临时清理；不改变配置格式。

- 本产品完整后端 **223/223**，最终生产构建通过；原工具箱完整后端 **652/652（51 suites）**、前端计算 **19/19**，随包Node22.22.2的安装/包名/多APK专项 **41/41**。证据：本地build/v020-backend-queue-final.log及原工具箱相应v040日志。
- 两套多APK浏览器各 **23/23**、原安卓各 **187/187**、Unity文件各 **24/24**、包名各 **18/18**；本产品导航/设置发布链接/合成Unity **19/19**。无浏览器异常，明暗截图已目视。日志：build/final-verify-android-*.log、final-verify-device-debugger.log。
- 最终ZIP/安装器隔离验收 **36/36**、真实TCP保护 **7/7**、Windows启停 **15/15**。包含真实解压、源码哈希、双Node依赖、Local/Lan生产启动、两模块及新API边界、安装/卸载保留data，未改变原工具箱实例。日志：build/v020-release-final2.log、final-verify-lan-access.log、final-verify-startup.log。多APK仅使用离线ADB和合成APK，真实手机未验收。


## v0.2.0 封版（2026-11-12）

**本地封版验收完成；远端发布待执行。** 用户已授权上传并发布，范围为TASK-040及TASK-042；源码及两锁文件统一0.2.0。最终ZIP/EXE已完成隔离验收，详见[封版验收记录](acceptance/DEVICE_DEBUGGER_V0_2_0_2026-11-12.md)。资产摘要保存在本地build/final-publish-assets.json；后续文档补记不重建已验收文件。

下一步：检查暂存源码，推送codex/device-debugger和新device-debugger-v0.2.0标签；草稿上传四份资产，核对大小及SHA256后正式发布，明确保持非latest。原工具箱由v0.4.0主线清单分发，不覆盖原有标签/资产；真实源码服务待按本项目身份重启和只读冒烟，结果另补本文件。

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
