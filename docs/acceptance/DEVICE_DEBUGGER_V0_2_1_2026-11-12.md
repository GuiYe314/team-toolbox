# device-debugger 0.2.1 封版验收记录

2026-11-12。TASK-044。实际远端上传和发布结果只记录在 [PROJECT_STATUS](../PROJECT_STATUS.md)。

最终包使用独立解压/安装目录；不向源码仓库提交运行数据、构建产物或本机快捷方式。旧版ZIP/EXE未覆盖；当前产品版本及两锁文件一致。

| 实际验证 | 结果 | 本机证据（build/，不提交） |
|---|---|---|
| 最终生产构建及Node22/24自检 | 通过 | v021-package-final.log |
| 完整离线后端（并发2） | 223/223 | v021-backend.log |
| 最终ZIP/安装器、源码/图标哈希、快捷方式、双Node、Local/Lan、保留data | 38/38 | v021-release.log |
| 原安卓网页 | 187/187 | v021-verify-android-wireless.log |
| Unity文件网页 | 24/24 | v021-verify-android-persistent.log |
| APK包名网页 | 18/18 | v021-verify-android-apk-info.log |
| 多APK网页 | 23/23 | v021-verify-android-apk-queue.log |
| 独立首页/设置/合成Unity HTTP网页 | 19/19 | v021-verify-device-debugger.log |
| 真实TCP局域网保护 | 7/7 | v021-verify-lan-access.log |
| Windows源码/发布启停与失败回收 | 15/15 | v021-verify-startup.log |

首次与主线并行Inno编译时出现文件占用，保留v021-package.log；随后单独重新构建并通过最终整包验收。使用临时浏览器、离线ADB和合成APK/Unity HTTP，没有搜索真实手机或安装APK。独立产品当前仍手动下载安装更新，不向主线manifest投放。

主线升级在新建旧版副本执行apply；真实程序目录不执行apply。独立安装测试前核对相应HKCU卸载身份不存在，使用新建目录静默安装/卸载，保留data的断言在合成数据上执行。

最终资产：

| 资产 | 字节 | SHA256 |
|---|---:|---|
| device-debugger-0.2.1.zip | 35701188 | e6f41bf80ee78a24524f549fb43ecc47987b5658f9301ca826f6b07199b0d604 |
| device-debugger-Setup-0.2.1.exe | 25237798 | e47b8ac8c851a2e23c203be3e60e84448db3b898ae4a6fa1fa271a1d18eb6ffe |
| device-debugger-0.2.1-SHA256.txt | 315 | 5f3bad753f9296e0630905332e6b47f9af5c6143a0b4ab298a902a0d38ed106b |
| device-debugger-manifest.json | 1202 | 5389ca71b352175721a2671948d605fb9d588d29b41a219332aaeefd23bf98e4 |

独立版标签为device-debugger-v0.2.1，正式发布必须非latest；主线标签为v0.5.0，其manifest.json指向主线ZIP。发布正文使用本产品发布说明，远端提交、四份资产大小及digest逐项核对后再正式发布。
