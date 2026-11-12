# 设备调试工具 0.1.0 验收记录

2026-11-12；TASK-038 / F-DEV-001、TASK-039 / F-ADB-002。进度和远端发布结果只记录在 [PROJECT_STATUS](../PROJECT_STATUS.md)。

## 产品与范围

- 基于 team-toolbox 的 df1c7da，独立分支 codex/device-debugger，版本0.1.0；安卓与 Unity 日志两模块、独立设置、3100/5174端口、独立 data/。
- 独立安装 AppId `{DD7438A4-6E96-4CD6-91F8-BC03D4939A12}`，默认安装到当前用户 device-debugger 目录；检测主工具箱目录并拒绝覆盖。
- 本轮包含 Unity persistentDataPath 标准外部目录浏览、预览/下载、添加与确认替换。当前用户/已安装包复查、参数字面量转义、链接隔离、大小上限、SHA256、原文件变化检测及取消清理受测。
- 无 SQLite、知识库、资源库、地球、模型或主线更新器；正式标签 device-debugger-v0.1.0，发行必须非 latest，无 manifest.json。原 main 的未提交网速功能保留。

## 实际执行证据

| 执行项 | 结果 | 本地日志（不提交） |
|---|---|---|
| backend/package.json 完整测试列表，Node v24.22.1 | 204/204 | build/device-backend.log |
| 同一完整列表，随包 Node v22.22.2 | 204/204 | build/device-node22-backend.log |
| android-persistent.test.js | 15/15，含真实子进程和固定 POSIX 脚本 | 完整后端日志 |
| frontend Vite 最终生产构建 | 通过 | build/device-build-final.log |
| frontend/verify-android-wireless.mjs，实际私网地址 | 187/187 | build/device-android-regression.log |
| frontend/verify-android-persistent.mjs，实际私网地址 | 24/24 | build/persistent-browser-final.log |
| frontend/verify-device-debugger.mjs | 18/18 | build/device-unity-browser.log |
| scripts/verify-lan-access.mjs | 7/7 | build/device-lan.log |
| scripts/verify-startup.mjs | 15/15 | build/device-startup.log |
| scripts/verify-release.mjs，最终 ZIP/EXE | 30/30 | build/device-release-verification.log |

后端默认测试离线。浏览器使用临时配置、离线 ADB 和合成文件；Unity 使用真实 HTTP 的合成专用协议，覆盖发现、历史/预览/堆栈、复制/全文/ZIP下载、错误恢复和离页取消。Windows 脚本使用隔离目录和显式随机空闲端口，不触碰真实手机或团队数据库。

发布资产验收实际解压 ZIP、逐项比对生产源码哈希、确认无测试/环境/数据/无关模块，分别运行随包Node和Node24的依赖自检，使用中文启动/关闭CMD在 Local/Lan 生产模式启动。验证首页/工具深链、两模块API、新文件API注册与400/403边界、实际私网访问、停止释放端口和保留data。安装器在随机隔离目录静默安装，真实启动、关闭、卸载并确认data保留；结束清理临时目录，原工具箱3000健康身份不变。

## 最终发布文件

| 文件 | 字节 | SHA256 |
|---|---:|---|
| device-debugger-0.1.0.zip | 34304168 | 95b8d281350ca5453591df0007d8462f3eb4093190f23e3953cc488f39321d2f |
| device-debugger-Setup-0.1.0.exe | 24145123 | 43bbb8c5dd0fbbd3779f927c9afe8f3d6ba686ddb2bd67d69565902fdd59a325 |
| device-debugger-manifest.json | 1117 | 9a1b9de69b30796c85cdc3af1897bbdca894025e615814b3158107762ff429d7 |

另有315字节 device-debugger-0.1.0-SHA256.txt。清单的下载URL固定指向本产品精确标签，不使用 latest。发布使用这批经过验收的原始资产，不因文档补记重建。

## 实际限制

没有真实手机/平板、另一物理客户端、真实扫码/安装/文件读写、厂商权限或Unity AOT新版APK的硬件验收。persistentDataPath只支持当前用户标准外部目录；无法锁住App并发改写，建议先关闭App并下载原文件备份。取消不能撤销已提交写入。主工具箱仍由原更新清单分发，独立版当前手动升级。

Codex 完成，未调用 WorkBuddy；积分未提供，无法确认。
