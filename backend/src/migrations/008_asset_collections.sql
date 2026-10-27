-- 008_asset_collections.sql
-- 资源集合（Packs）：跨目录的资源编组。
--
-- 为什么文件夹不够：
--   asset_folders 是一棵树，一个资源只能待在一个位置 —— 它回答「这个资源归哪儿管」。
--   但实际工作中还有另一类需求：「这次展会要用的 12 个模型」「下周评审的这一批」
--   「给外包的这套贴图」。这些编组横跨多个文件夹、临时存在、用完就散，
--   而且同一个资源会同时属于多个编组（既在展会包里，也在评审包里）。
--   用文件夹表达这类需求会逼着人复制文件或反复移动。
--   参考 Modelibr 的 Packs / Projects —— 它对标的正是这个问题。
--
-- 设计要点：
--   1. 多对多：一个资源可属多个集合，一个集合可含多个资源。
--   2. 集合是**视图**，不是容器：把资源从集合移除，不影响资源本身与它的文件夹归属。
--   3. 软删联动：资源进回收站后不出现在集合里（查询时过滤 is_deleted = 0），
--      恢复后自动回到原集合 —— 不需要额外维护成员关系。
--   4. 永久删除时 CASCADE 清掉成员行，不留悬空引用。

CREATE TABLE IF NOT EXISTS asset_collections (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    description TEXT    NOT NULL DEFAULT '',
    created_by  TEXT    NOT NULL DEFAULT 'local',
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 集合名唯一：团队里两个人各建一个「展会包」时，必须撞车而不是并存，
-- 否则同名的两个集合谁也分不清该用哪个。
CREATE UNIQUE INDEX IF NOT EXISTS ux_asset_collections_name
    ON asset_collections(name);

CREATE TABLE IF NOT EXISTS asset_collection_items (
    collection_id INTEGER NOT NULL REFERENCES asset_collections(id) ON DELETE CASCADE,
    asset_id      INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    added_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (collection_id, asset_id)
);

-- 反向查询用：某个资源被哪些集合引用（集合详情之外的「它还在哪些包里」）
CREATE INDEX IF NOT EXISTS idx_asset_collection_items_asset
    ON asset_collection_items(asset_id);
