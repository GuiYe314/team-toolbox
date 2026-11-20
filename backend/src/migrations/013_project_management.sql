-- 项目管理首期字段：项目状态和待办计划属性。
ALTER TABLE kb_projects ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
    CHECK(status IN ('planning', 'active', 'paused', 'completed', 'archived'));
ALTER TABLE kb_projects ADD COLUMN due_at TEXT;

ALTER TABLE kb_project_todos ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal'
    CHECK(priority IN ('urgent', 'high', 'normal', 'low'));
ALTER TABLE kb_project_todos ADD COLUMN due_at TEXT;
ALTER TABLE kb_project_todos ADD COLUMN assignee TEXT NOT NULL DEFAULT '';
ALTER TABLE kb_project_todos ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]';

ALTER TABLE kb_project_todos ADD COLUMN stage TEXT NOT NULL DEFAULT 'pending'
    CHECK(stage IN ('pending', 'doing'));
