-- 007_document_trash.sql
-- 文档回收站：把「物理删除」改成「软删除 + 可恢复」。
--
-- 背景：资源侧（003_assets.sql）从一开始就是软删，有回收站、恢复、永久删除；
-- 文档侧却是 DELETE FROM documents 直接物理删除，且 ON DELETE CASCADE
-- 会连带删掉整棵子树 —— 误删一篇带子页的文档，没有任何挽回手段。
-- 这是与「备份不含资源文件」同类的数据保护缺口：用户以为自己有退路，实际没有。
--
-- 设计要点：
--   1. 只加标记列，不改主键与外键 —— 现有数据零迁移成本，默认 0 即全部正常。
--   2. 保留 ON DELETE CASCADE：它现在只在「永久删除」时触发，
--      软删阶段不再执行 DELETE，因此不会连带清掉子页与标签关联。
--   3. 回收站查询专用索引：正常列表恒带 is_deleted = 0，走索引避免全表扫。

ALTER TABLE documents ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE documents ADD COLUMN deleted_at TEXT;
ALTER TABLE documents ADD COLUMN deleted_by TEXT;

CREATE INDEX IF NOT EXISTS idx_documents_deleted
    ON documents(is_deleted, updated_at DESC);

-- 回收站按删除时间倒序看「最近删了什么」更符合直觉，
-- 但 deleted_at 可空（历史数据），所以索引仍用 updated_at 兜底排序。
