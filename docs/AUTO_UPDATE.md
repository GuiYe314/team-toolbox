# 自动更新（运维说明）

> 面向部署者：怎么配置更新源、怎么发一个新版本、更新时到底发生了什么。
> 功能条目见 [FUNCTIONAL_SPEC](FUNCTIONAL_SPEC.md) F-OPS-003。

## 1. 它解决什么问题

这个工具已经发生过一次「必须升级但没人升」：v0.1.0 的安装包在部分机器上
装完起不来，修好的 v0.1.1 躺在发布页上，用户并不知道要再去下载一次。

自动更新把这件事变成：**应用自己知道有新版本，点一下就装好**。

## 2. 更新源：只要能放静态文件就行

更新源是**一个目录**，里面两个文件：

```
<更新源>/
├── manifest.json               ← 清单：最新版本、包地址、SHA256
└── team-toolbox-0.1.2.zip      ← 发布包
```

可以是：

| 形态 | 填写示例 |
|---|---|
| 内网共享目录 | `\\fileserver\share\team-toolbox` |
| 本机目录 | `D:\releases\team-toolbox` |
| 静态文件服务 | `https://example.com/team-toolbox` |
| GitHub Releases 资产 | `https://github.com/<owner>/<repo>/releases/latest/download` |

**为什么把更新源做成可配置，而不是写死 GitHub**

仓库是公开的，所以「匿名访问 404」这条障碍已经不存在了（2026-10-27 公开）。
GitHub Releases 现在是**有效选项**，填这个地址即可：

```
https://github.com/GuiYe314/team-toolbox/releases/latest/download
```

它指向「最新一次 Release 的资产」，地址固定、不用改版本号，非常适合做更新源。

但仍有三个现实理由让它不适合当**唯一**方案：

1. **受控内网可能出不了网** —— 部署前提就是内网，很多机器根本访问不到 GitHub。
2. **未认证 API 限流 60 次/小时/IP**，`releases/latest` 接口也在限流范围内。
   公司 NAT 下十几台机器各查几次就可能打满，且 403 无法区分「限流」与「仓库不存在」。
   （用 `releases/latest/download/<文件名>` 直连资产不走 API，但检查版本仍需读清单。）
3. **资产可达性不稳定** —— 实际下载会跳转到 `release-assets.githubusercontent.com`，
   部分地区时通时断。内网共享目录反而最可靠。

所以：**能出网的小团队可以直接用 GitHub；纯内网环境指向共享目录**。换源不需要改代码。

### 配置方式

两种，环境变量优先：

1. 环境变量 `UPDATE_SOURCE`
2. 界面上「设置 → 更新源地址」保存（写入 `data/updates/source.json`）

用环境变量指定时，界面上的输入框会置灰并提示「由环境变量指定」——
避免出现「界面上改了但没生效」的困惑。

## 3. 发一个新版本

打包脚本现在会顺带产出 `manifest.json`：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build_release.ps1 `
    -Version 0.1.2 `
    -Notes "修复批量删除后回收站残留的问题"
```

产出（`release/` 目录）：

- `team-toolbox-Setup-0.1.2.exe` —— 安装包（新机器用）
- `team-toolbox-0.1.2.zip` —— 便携包（**自动更新用这个**）
- `team-toolbox-0.1.2-SHA256.txt` —— 校验清单
- `manifest.json` —— **更新清单**

把 **`manifest.json` + `team-toolbox-0.1.2.zip`** 两个文件放进更新源目录即可。
只放 zip 不放清单，客户端什么也找不到；只放清单不放 zip，下载会失败。

### 如果更新源是 GitHub Releases

发布时把清单一起作为资产上传（少传它，客户端读不到版本信息）：

```bash
gh release create v0.1.2 --repo GuiYe314/team-toolbox \
  --title "team-toolbox 0.1.2" \
  --notes-file docs/releases/V0_1.2.0-RELEASE.md \
  release/team-toolbox-Setup-0.1.2.exe \
  release/team-toolbox-0.1.2.zip \
  release/team-toolbox-0.1.2-SHA256.txt \
  release/manifest.json \
  --latest
```

然后把更新源填成 `https://github.com/GuiYe314/team-toolbox/releases/latest/download`。
这个地址指向「最新 Release 的资产」，不会随版本号变化。

> `--latest` 很重要：`releases/latest` 只认被标记为 latest 的那一个。

### 关于版本号

`-Version` 会同时写入：

- 包内 `backend/package.json` 的 `version`（后端从这里读，不再硬编码）
- 安装包的 `AppVersion`
- 更新清单的 `latest` 与 `releases[].version`

**不要手工去改这些地方**。历史上版本号散落在四处且只覆盖了一处，
导致 v0.1.1 的包对外自称 0.1.0 —— 而自动更新完全依赖版本比对。

## 4. 更新时到底发生了什么

```
检查：读 manifest.json → 与本地版本比对（语义化比较，0.1.10 > 0.1.9）
  ↓
下载：流式写入 data/updates/<版本>/package.zip
      边下边算 SHA256，与清单不一致 → 丢弃文件，不安装
  ↓
自检：解压到 data/updates/<版本>/staged/
      结构必须含 backend / frontend/dist / runtime/node.exe
      然后**用包内自带的 node.exe** 加载包内的 better-sqlite3 跑一次内存库
      ↑ 这一步专门拦「ABI 不匹配」—— v0.1.0 就是这么漏出去的
  ↓
备份：把全部数据（文档 + 文档图片 + 资源文件）导成
      data/updates/<版本>/pre-update-backup.zip
  ↓
安装：服务退出 → 独立的 apply.cmd 接手
      1. 等旧进程按 PID 退出（运行中的 node.exe 无法覆盖）
      2. 把当前程序复制到 data/updates/rollback/ 作为回滚快照
      3. robocopy 暂存目录 → 应用目录，**排除 data/**
      4. 启动新版本
  ↓
确认：新版本启动成功后删掉 data/updates/pending.json
      60 秒内标记仍在 → 判定新版本没起来 → 自动回滚 + 写 ROLLBACK.txt
```

### 几条刻意的设计

- **不原地覆盖**：Windows 上运行中的 `node.exe` 换不了，只能「先退出再换」，
  所以安装动作由 `cmd.exe` 执行（它是系统进程，不在被替换的目录里）。
- **`data/` 永不参与替换**：robocopy 明确排除。数据库、上传图片、资源文件
  都在这里，任何情况下都不该被升级动作碰到。
- **不用 `robocopy /MIR`**：被删掉的文件残留在原地，比误删用户文件安全得多。
- **延时用 `ping` 而不是 `timeout /t`**：脚本以无控制台方式启动时
  `timeout` 会立刻返回，会让「新版本还在启动」被误判成「启动失败」而误回滚。
- **临时占用约 500 MB**：74 MB 的包解压后约 300 MB，加回滚快照。
  升级完成后回滚快照会自动清理；`data/updates/` 下的历史包可以手工删。

## 5. 出问题了怎么办

| 现象 | 处理 |
|---|---|
| 提示「检查失败：manifest.json 不是合法的 JSON」 | 清单被写坏了，或用某个工具另存时加了 BOM（服务端会剥 BOM，但请确保是合法 JSON） |
| 提示「包结构不完整，缺少 runtime/node.exe」 | 更新源里的 zip 不是完整发布包（可能是手工重打的） |
| 提示「包内运行时自检未通过」 | 这个包的依赖与包内 Node 不匹配，**不要装**，重新打包 |
| 界面顶部提示「上次更新没有成功，已自动回滚」 | 新版本启动失败，已退回原版本。看 `data/updates/apply.log` 找原因 |
| 更新后版本没变 | 检查 `data/updates/pending.json` 与 `ROLLBACK.txt`，再看 `apply.log` |

日志位置：`data/updates/apply.log`（换文件脚本的输出）。

## 6. 手工回滚

回滚快照只在升级过程中存在，成功后会被删掉。若需要退回旧版本：

1. 卸载后用旧版安装包重装（`data/` 默认保留）
2. 或用升级前备份 `data/updates/<版本>/pre-update-backup.zip` 恢复数据
   （入口：知识库 → 导入 → 选择该 zip）

## 7. 不做什么

- **不做增量更新**：整包下载，简单可靠。代价是每次下 70 多 MB，
  内网千兆下是几秒钟。要做差分需拆成 `runtime` + `app` 两个包，当前不值得。
- **不做静默安装**（不询问就装）：升级会重启服务，至少要让用户知道。
- **不做「进程内热替换」**：Node 服务端有 `require` 缓存、原生模块与数据库连接，
  真热更新得不偿失。能即时生效的只有前端 `dist`，而那部分重启也很便宜。
