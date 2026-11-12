# 设备调试工具项目状态（唯一状态源）

- 2026-11-12 / TASK-039：两产品代码、构建、后端与隔离浏览器验收完成。支持当前 Android 用户的 Unity 标准外部目录浏览、文本预览、下载、添加与确认替换；原文件变化检测、传送 SHA256 校验与取消清理已验证。真实手机和厂商权限兼容性未验收。

## TASK-038（2026-11-12）

独立产品代码与发行资产验收完成，远端发布待执行。基于主线 df1c7da 建立 codex/device-debugger 分支，只保留安卓调试、Unity 设备日志与设置；生产端口3100、开发5174、独立安装身份和 data/，不含 SQLite、其他工具或主线更新器。完整工具箱的原有未提交网速改动保留。

## 验证证据

- backend 完整离线测试 **204/204**，分别使用 Node v24.22.1 和随包 Node v22.22.2 执行；其中 android-persistent.test.js **15/15**，包含真实二进制子进程及 Git Bash 固定 POSIX 脚本执行。日志：本地 build/device-backend.log、device-node22-backend.log。
- 最终 frontend 生产构建通过；实际私网地址的安卓原功能浏览器 **187/187**、新文件面板 **24/24**。覆盖预览/下载、添加、替换/冲突、权限失败恢复、取消/后台/离页、Android 用户切换、明暗布局。日志：build/device-build-final.log、device-android-regression.log、persistent-browser-final.log。
- 独立导航/设置及 Unity 合成 HTTP 浏览器 **18/18**，真实 TCP 开发代理 **7/7**，Windows 启停 **15/15**；全部使用临时配置、离线 ADB 或合成日志，未访问真实手机。日志：build/device-unity-browser.log、device-lan.log、device-startup.log。
- 便携包与安装器隔离验收 **30/30**：全新目录解压、白名单与逐项哈希、双 Node 依赖加载、Local/Lan 中文 CMD 生产启停、深链、两模块 API/跨站拒绝、实际私网 IP、隔离安装/卸载及保留 data。原工具箱3000实例身份与健康保持。日志：build/device-release-verification.log。
- 原工具箱同步完整后端 **624/624**、前端计算 **19/19**、安卓浏览器 **187/187**、新面板 **24/24** 和生产构建通过；2026-11-12 已按项目路径隐藏重启，本机与实际私网接口已生效，同源无效请求400、跨站403、健康含数据库正常。原实时网速页面与只读接口保留。
- 资产 SHA256、大小和执行范围见[独立封版验收记录](acceptance/DEVICE_DEBUGGER_V0_1_0_2026-11-12.md)。build/、release/ 与运行数据均不进入源码提交。

## 下一步

推送 codex/device-debugger，建立 device-debugger-v0.1.0 正式发布并明确 latest=false，核对四份资产与原主线 latest=v0.3.1 后记录结果。真实手机/平板、另一物理客户端、厂商文件权限及 App 并发写入仍需实际环境验证。

Codex 完成当前实现与验收，未调用 WorkBuddy；积分未提供，无法确认。
