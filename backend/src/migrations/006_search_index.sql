-- 迁移 006：全文检索索引（FTS5）
--
-- 背景：搜索此前是 `LIKE '%kw%'` 全表扫描（store.js 的 searchDocuments）。
-- 两个问题：
--   1. **不是子串匹配**：搜「部属」找不到「部署指南」—— 因为 LIKE 是连续子串，
--      而中文用户习惯按词搜。
--   2. **没有相关性排序**：结果只按 updated_at 排，命中度高的不一定靠前。
--   3. 文档多了就是全表 IO。
--
-- 为什么不用 SQLite 内置分词器：
--   unicode61  把连续 CJK 当成一个 token，「部署指南」是一个词，
--              搜「部署」命中不了 —— 而这恰恰是最常见的搜法。
--   trigram    支持子串，但最短 3 字符，搜「部署」（2 字）无结果。
--   ascii      只处理 ASCII，对中文完全无效。
--
-- 结论：中文子串搜索必须自己分词。FTS5 的自定义 tokenizer 需要 C 扩展
-- （better-sqlite3 不支持），所以**索引在应用层维护**：
--   - 本迁移建 FTS5 虚表（content-less，存分词后的 token）
--   - 写入 / 更新 / 删除文档时由 store.js 同步索引行
--   - 服务启动时检查索引行数与文档数是否一致，不一致则全量重建
--     （见 backend/src/search-index.js 的 ensureIndexSynced）
--
-- 分词策略：中文 bigram（2-gram）+ 英文整词，详见 search-index.js 的 tokenize()。
--
-- 为什么用 content-less 表（content=''）：
--   存进去的是**分词后的 token**而非原文，无法用 external content 模式
--   （那要求 FTS 表与主表内容一致）。content-less + doc_id 关联最直接。
--
-- 降级：若 SQLite 构建不含 FTS5（极少见），searchDocuments 会自动退回
-- LIKE 实现，搜索功能不中断，只是没有子串匹配与相关性排序。

CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
    doc_id UNINDEXED,
    tokens,
    tokenize = 'unicode61'
);
