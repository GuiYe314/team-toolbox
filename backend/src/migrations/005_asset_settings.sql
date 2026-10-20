-- 迁移 005：资源存储路径配置（镜像目录）
--
-- 背景：用户 2026-10-20 要求「添加设置资源保存路径，当选择路径后资源自动拷贝到指定路径」。
--
-- 语义（重要，别误读）：
--   本配置是**镜像目录**，不是主存储位置。
--   - 主存储永远是 data/assets/<assetId>/<versionId>/（服务端的权威副本）
--   - 镜像目录是用户指定的**额外副本**，用于把资源同步到
--     Unity 项目目录 / NAS / 同步盘等外部位置
--   - 设置路径后：① 立即把现有资源全量拷贝过去；② 之后每次上传自动拷贝
--
-- 为什么不做「主存储切换」：
--   主存储路径决定了数据库里 storage_key 的解析基准。若允许运行时切换，
--   存量资源的 storage_key 全部失效，且服务重启、磁盘故障时无兜底。
--   镜像语义既满足「自动拷贝到指定路径」的需求，又不会让数据受外部目录可用性影响。
--
-- 存数据库而非配置文件：可通过 API 读写、支持多实例一致、随备份一起走。
--
-- key-value 结构：便于将来扩展其他设置项（如「是否同时镜像 preview/thumbnail」）。

CREATE TABLE IF NOT EXISTS asset_settings (
    key        TEXT PRIMARY KEY,
    value      TEXT    NOT NULL,
    updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
