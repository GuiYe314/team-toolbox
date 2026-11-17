-- 保存参数而非派生结果，按同一十进制算法重建；不修改既有文档或资源。
CREATE TABLE IF NOT EXISTS quick_calculations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    name_key TEXT NOT NULL UNIQUE,
    parameters_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
