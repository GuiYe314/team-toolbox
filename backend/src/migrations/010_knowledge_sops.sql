-- 模板可变，执行保存独立快照；删除模板只解除历史关联。
CREATE TABLE kb_sop_templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    name_key TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    steps_json TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE kb_sop_runs (
    id TEXT PRIMARY KEY,
    template_id TEXT REFERENCES kb_sop_templates(id) ON DELETE SET NULL,
    template_name TEXT NOT NULL,
    template_version INTEGER NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    steps_json TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'completed')),
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT
);
CREATE INDEX idx_kb_sop_runs_updated ON kb_sop_runs(updated_at DESC, id);
