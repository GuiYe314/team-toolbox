-- 初始 schema：documents / categories / tags / document_tags
-- 依据 docs/ARCHITECTURE.md 第 3、10 节
-- 约定：
--   * 所有表带 schema_version 标记，本迁移版本为 1。
--   * 外键约束启用（PRAGMA foreign_keys = ON）。
--   * updated_at 由服务端写入，不在数据库层用触发器维护。

CREATE TABLE IF NOT EXISTS categories (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL UNIQUE,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tags (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL UNIQUE,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS documents (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    title        TEXT    NOT NULL,
    content_md   TEXT    NOT NULL DEFAULT '',
    category_id  INTEGER,
    version      INTEGER NOT NULL DEFAULT 1,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_documents_updated_at ON documents(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_documents_category_id ON documents(category_id);

CREATE TABLE IF NOT EXISTS document_tags (
    document_id  INTEGER NOT NULL,
    tag_id       INTEGER NOT NULL,
    PRIMARY KEY (document_id, tag_id),
    FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id)      REFERENCES tags(id)      ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_document_tags_tag_id ON document_tags(tag_id);

-- 迁移元数据表：跟踪已应用的迁移版本
CREATE TABLE IF NOT EXISTS schema_migrations (
    version     INTEGER PRIMARY KEY,
    applied_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);