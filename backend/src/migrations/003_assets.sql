-- 迁移 003：资源管理（Asset / AssetVersion / Folder）
--
-- 背景：用户 2026-10-20 要求新增「资源管理」模块，面向 Unity 项目、
--       三维博物馆、3D 模型、图/视频/音频/PDF/Markdown/代码等资产。
--
-- 核心设计约束（用户明确要求，改动前务必确认）：
--   1. **版本必须独立保存**。不能用「一个 File 表 + 覆盖文件」的实现。
--      asset_versions 每行对应一份不可变的物理文件（original_storage_key 唯一），
--      历史版本永不因新上传而改变。
--   2. **LatestVersion 与 PublishedVersion 完全独立**。
--      asset.latest_version_id  = 团队上传到的最新版本
--      asset.published_version_id = Unity 客户端实际使用的版本
--      两者可以相差任意多个版本；Unity 只查 published，绝不默认用 latest。
--   3. **恢复历史版本 = 复制内容生成新版本**，不把 latest 指针回拨。
--      用户恢复 v3 时生成 v8（内容 = v3），历史 v4~v7 全部保留。
--      实现见 asset-store.js 的 restoreAssetVersion()。
--   4. **删除只标记不删文件**。is_deleted / deleted_at / deleted_by，
--      存储文件留在盘上，由「永久删除」才真正 unlink。
--
-- 存储布局（data/assets/<assetId>/<versionId>/）：
--   original.<ext>   原始文件，下载与永久删除的对象
--   preview.<ext>    预览派生文件（GLB→glb、视频→mp4、PDF→png…）
--   thumbnail.<ext>  缩略图
-- 预览与缩略图是「可重新生成」的派生物，缺失不影响 original；
-- 但**每个版本各有各的** preview/thumbnail，不共享 latest 的。
--
-- SQLite 注意：
--   * latest_version_id / published_version_id 用 ALTER 方式留空建列，
--     避免建表时与 asset_versions 形成循环外键（SQLite 支持延迟外键但徒增排错成本）。
--     这两个指针的一致性由 asset-store.js 在同一事务内维护。
--   * ON DELETE SET NULL：删版本时把指向它的指针置空，而不是连带删资源。

-- ═══ 文件夹 ═══════════════════════════════════════════════════════
-- 对应 data 模型中的 Folder：id / parentId / name / createdBy / createdAt
CREATE TABLE IF NOT EXISTS asset_folders (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    parent_id   INTEGER REFERENCES asset_folders(id) ON DELETE CASCADE,
    name        TEXT    NOT NULL,
    created_by  TEXT    NOT NULL DEFAULT 'local',
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 同一父级下文件夹名唯一（根目录 parent_id IS NULL 亦受约束，
-- 用 COALESCE 让 NULL 在唯一索引中视为同一个值）
CREATE UNIQUE INDEX IF NOT EXISTS ux_asset_folders_sibling_name
    ON asset_folders(COALESCE(parent_id, 0), name);
CREATE INDEX IF NOT EXISTS idx_asset_folders_parent ON asset_folders(parent_id);

-- ═══ 资产 ═══════════════════════════════════════════════════════════
-- 对应 data 模型中的 Asset。
-- type 为归类（image/video/audio/model/pdf/markdown/text/archive/other），
-- mime_type 存真实 MIME；两者分离是因为「3D模型」这一类可跨多种 MIME。
CREATE TABLE IF NOT EXISTS assets (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    name                 TEXT    NOT NULL,
    folder_id            INTEGER REFERENCES asset_folders(id) ON DELETE SET NULL,
    type                 TEXT    NOT NULL DEFAULT 'other',
    mime_type            TEXT    NOT NULL DEFAULT 'application/octet-stream',
    ext                  TEXT    NOT NULL DEFAULT '',

    -- LatestVersion：团队上传到的最新版本
    latest_version_id    INTEGER,
    -- PublishedVersion：Unity 客户端正式使用的版本，可为空（从未发布）
    published_version_id INTEGER,

    status               TEXT    NOT NULL DEFAULT 'draft',
    description          TEXT    NOT NULL DEFAULT '',
    created_by           TEXT    NOT NULL DEFAULT 'local',
    created_at           TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at           TEXT    NOT NULL DEFAULT (datetime('now')),

    -- 回收站：只标记不删文件
    is_deleted           INTEGER NOT NULL DEFAULT 0,
    deleted_at           TEXT,
    deleted_by           TEXT
);

CREATE INDEX IF NOT EXISTS idx_assets_folder   ON assets(folder_id);
CREATE INDEX IF NOT EXISTS idx_assets_updated  ON assets(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_assets_type     ON assets(type);
CREATE INDEX IF NOT EXISTS idx_assets_status   ON assets(status);
-- 回收站查询专用：正常列表恒带 is_deleted = 0，走这条索引避免全表扫
CREATE INDEX IF NOT EXISTS idx_assets_deleted  ON assets(is_deleted, updated_at DESC);

-- ═══ 版本 ═══════════════════════════════════════════════════════════
-- 对应 data 模型中的 AssetVersion。每行 = 一份不可变文件。
CREATE TABLE IF NOT EXISTS asset_versions (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_id             INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,

    -- 版本号从 1 起、逐级递增、同一资产内唯一
    version_number       INTEGER NOT NULL,

    -- 三个存储键：原始 / 预览 / 缩略图。
    -- 均为服务端生成的相对路径，**不含用户提供的文件名**，杜绝路径穿越。
    original_storage_key TEXT    NOT NULL,
    preview_storage_key  TEXT,
    thumbnail_storage_key TEXT,

    file_size            INTEGER NOT NULL DEFAULT 0,
    -- sha256：用于秒传/去重与完整性校验；64 位十六进制
    sha256               TEXT,
    mime_type            TEXT    NOT NULL DEFAULT 'application/octet-stream',

    -- 元数据（宽高/时长/网格数/时长…）以 JSON 文本存，SQLite 无 JSON 类型
    metadata             TEXT    NOT NULL DEFAULT '{}',

    -- 预览管线状态：none / pending / processing / ready / failed
    -- 预览失败**不得影响 original**，只能反映在这里
    preview_status       TEXT    NOT NULL DEFAULT 'none',
    preview_error        TEXT,

    comment              TEXT    NOT NULL DEFAULT '',
    created_by           TEXT    NOT NULL DEFAULT 'local',
    created_at           TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_asset_versions_number
    ON asset_versions(asset_id, version_number);
CREATE INDEX IF NOT EXISTS idx_asset_versions_asset ON asset_versions(asset_id, version_number DESC);

-- ═══ 标签 ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS asset_tags (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL UNIQUE,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS asset_tag_links (
    asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    tag_id   INTEGER NOT NULL REFERENCES asset_tags(id) ON DELETE CASCADE,
    PRIMARY KEY (asset_id, tag_id)
);

-- ═══ 操作记录 ═══════════════════════════════════════════════════════
-- 用户要求记录：上传 / 创建版本 / 下载 / 发布 / 恢复 / 重命名 / 移动 /
-- 删除 / 恢复删除 / 永久删除。version_id 允许为空（非版本级操作）。
CREATE TABLE IF NOT EXISTS asset_operation_logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_id    INTEGER REFERENCES assets(id) ON DELETE CASCADE,
    version_id  INTEGER,
    action      TEXT    NOT NULL,
    detail      TEXT    NOT NULL DEFAULT '',
    operator    TEXT    NOT NULL DEFAULT 'local',
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 按资产查历史（详情页「操作记录」Tab）
CREATE INDEX IF NOT EXISTS idx_asset_logs_asset
    ON asset_operation_logs(asset_id, created_at DESC);
-- 按时间查最近操作（「最近使用」视图）
CREATE INDEX IF NOT EXISTS idx_asset_logs_time
    ON asset_operation_logs(created_at DESC);