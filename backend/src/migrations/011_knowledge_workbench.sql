-- 工作台扩展；普通笔记仍保存在 documents，不改写旧正文。
CREATE TABLE kb_entries (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL,
 data TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX kb_entries_kind ON kb_entries(kind, updated_at);
CREATE TABLE kb_note_meta (
 document_id INTEGER PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
 data TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE kb_note_revisions (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
 title TEXT NOT NULL, content_md TEXT NOT NULL, version INTEGER NOT NULL,
 saved_at TEXT NOT NULL
);
CREATE INDEX kb_revisions_document ON kb_note_revisions(document_id, id);
CREATE TABLE kb_daily_notes (
 day TEXT PRIMARY KEY, document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE
);
CREATE TABLE kb_action_requests (request_id TEXT PRIMARY KEY, action_id TEXT NOT NULL, result TEXT NOT NULL);
-- 捕获所有入口（包括旧编辑器）的上一版正文；仅正文/标题变化才留历史。
CREATE TRIGGER kb_capture_revision BEFORE UPDATE OF title, content_md ON documents
WHEN OLD.title != NEW.title OR OLD.content_md != NEW.content_md
BEGIN
 INSERT INTO kb_note_revisions(document_id,title,content_md,version,saved_at)
 VALUES(OLD.id,OLD.title,OLD.content_md,OLD.version,OLD.updated_at);
 DELETE FROM kb_note_revisions WHERE document_id=OLD.id AND id NOT IN
 (SELECT id FROM kb_note_revisions WHERE document_id=OLD.id ORDER BY id DESC LIMIT 20);
 DELETE FROM kb_note_revisions WHERE id <= COALESCE((SELECT id FROM
 (SELECT id,SUM(length(CAST(content_md AS BLOB))) OVER (ORDER BY id DESC) AS size
 FROM kb_note_revisions) WHERE size>52428800 ORDER BY id DESC LIMIT 1),-1);
END;
