-- 迁移 002：页面树（文档支持父子层级，对应 Notion 式子页面）
--
-- 背景：用户 2026-10-19 要求知识库按 Notion 的「页面 + 子页面」形态改造，
--       侧边栏需要可展开的页面树，页面正文需要列出子页面。
--
-- 约定：
--   * parent_id 为自引用外键，NULL 表示顶层页面。
--   * ON DELETE CASCADE：删除父页面时连带删除其子树（前端删除确认会提示子页面数量）。
--   * SQLite 的 ALTER TABLE ADD COLUMN 允许新增外键列，前提是默认值为 NULL，符合本场景。

ALTER TABLE documents ADD COLUMN parent_id INTEGER REFERENCES documents(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_documents_parent_id ON documents(parent_id);
