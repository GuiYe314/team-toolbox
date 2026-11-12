# 设备调试工具 0.2.0 封版验收记录

2026-11-12；TASK-040、TASK-042。进度和远端发布结果只记录在[PROJECT_STATUS](../PROJECT_STATUS.md)。

## 范围与执行

本版增加无需ADB/SDK/手机的APK包名读取和单/多设备多APK安装队列；保留原安卓、Unity日志与文件功能。最多20包和20台设备，每包1GiB、整批4GiB，多文件时最多两设备并行、每台按文件顺序安装，逐项反馈及精确失败重试。无配置迁移，仍使用独立安装身份、data及3100/5174端口，不增加主线其他工具或更新器。

| 实际执行项 | 结果 | 本地证据（不提交） |
|---|---|---|
| 完整后端测试列表 | 223/223 | build/v020-backend-queue-final.log |
| 最终前端生产构建 | 通过 | build/v020-package-final.log |
| 多APK隔离浏览器 | 23/23 | build/final-verify-android-apk-queue.log |
| 原安卓、Unity文件、APK包名 | 187/187、24/24、18/18 | build/final-verify-android-wireless.log、final-verify-android-persistent.log、final-verify-android-apk-info.log |
| 独立导航、设置发布链接及合成Unity协议 | 19/19 | build/final-verify-device-debugger.log |
| 真实TCP Local/Lan保护 | 7/7 | build/final-verify-lan-access.log |
| Windows启停 | 15/15 | build/final-verify-startup.log |
| 最终ZIP和安装器 | 36/36 | build/v020-release-final2.log |

浏览器使用临时配置、离线ADB与合成APK，覆盖单/多设备多文件、失败继续及精确重试、取消/后台/离页、明暗布局；无浏览器异常，截图已经目视。Unity使用本机真实HTTP的合成日志协议，不读取真实设备或团队数据库。

发布验收真实解压最终ZIP并核对生产源码哈希、白名单、无测试/环境/data和无关工具；分别用随包Node22.22.2及Node24加载依赖。实际中文CMD在Local/Lan生产启动，验证深链、两模块API、APK包名及多APK端点400/403、实际私网访问、停止释放端口。安装器在随机目录实际安装/启动/卸载并确认保留合成data。回收临时服务和目录，原工具箱3000实例保持不变。两产品的新增安装/包名/队列模块另经随包Node22.22.2专项41/41。

## 验收资产

| 文件 | 字节 | SHA256 |
|---|---:|---|
| device-debugger-0.2.0.zip | 34320404 | 376dc08dfe2fff14ecd9df88921881a789d4ea2afaa9bf195ed22b6e4cebd047 |
| device-debugger-Setup-0.2.0.exe | 24151614 | d3ed09687e6c53cf82c6ef0e10745c917b14aa36d60975cf0c787c398934cef1 |
| device-debugger-manifest.json | 1202 | d2731a2513b9bc15d599aeb6abd76dd7050a89e26379c0b34a615bfdf63bd816 |
| device-debugger-0.2.0-SHA256.txt | 315 | f1b513066b119d935cccd9d5845f9d786628adfd884964b29fdf7388710e45f8 |

清单固定指向device-debugger-v0.2.0，不包含主线manifest.json。发布使用以上原始文件，不因文档补记重新打包；独立发行保持非latest。

## 实际限制

没有真实手机/平板、另一物理客户端、扫码/安装、厂商权限或Unity AOT新版APK的硬件验收。公开APK读取不代表安装成功；取消不能撤销已完成安装或写入。persistentDataPath仅为当前用户标准外部目录，无法锁住App并发写入。独立版继续手动升级，不可使用主工具箱安装包覆盖。

Codex 完成，未调用 WorkBuddy；积分未提供，无法确认。
