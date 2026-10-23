// 全文检索（FTS5）的测试。
//
// 本文件的存在源于一个实测结论：SQLite 内置分词器对中文都不够用。
//
//   unicode61  把连续 CJK 当成一个 token。「部署指南」是一个词，
//              搜「部署」命中不了 —— 而这恰恰是中文用户最常见的搜法。
//   trigram    支持子串，但最短 3 字符。搜「部署」（2 字）无结果。
//   ascii      只处理 ASCII，对中文完全无效。
//
// 所以实现了自研分词（中文 bigram + 英文整词），见 search-index.js。
//
// 这里测的是**行为**而非实现：搜什么词该命中什么、搜什么不该命中什么。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestingDatabase } from './db.js';
import {
    createDocument, updateDocument, deleteDocument, deleteDocuments, searchDocuments
} from './store.js';
import { tokenize, indexText, buildMatchExpr, ensureIndex, reindexAll, ensureIndexSynced } from './search-index.js';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

/** 建一个带完整 schema 的内存库。 */
function makeDb() {
    const db = createTestingDatabase({ memory: true });
    for (const f of ['001_init.sql', '002_page_tree.sql', '003_assets.sql', '004_placeholder.sql', '005_asset_settings.sql', '006_search_index.sql']) {
        db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
    }
    return db;
}

/** 建文档并返回 id。 */
function addDoc(db, title, content_md = '') {
    return createDocument({ connection: db, title, content_md }).id;
}

/** 搜标题（只看命中的标题列表）。 */
function searchTitles(db, kw) {
    return searchDocuments({ connection: db, keyword: kw, limit: 50 }).items.map((i) => i.title);
}

describe('分词', () => {
    test('中文切成 bigram', () => {
        assert.deepEqual(tokenize('部署指南'), ['部署', '署指', '指南']);
    });

    test('英文按整词保留并转小写', () => {
        assert.deepEqual(tokenize('Digital Transform'), ['digital', 'transform']);
    });

    test('中英混排分别处理', () => {
        assert.deepEqual(tokenize('Git 工作流'), ['git', '工作', '作流']);
    });

    test('单个中文字保留为单字', () => {
        assert.deepEqual(tokenize('猫'), ['猫']);
    });

    test('标点是词边界', () => {
        assert.deepEqual(tokenize('a，b'), ['a', 'b']);
    });

    test('空串产出空 token', () => {
        assert.deepEqual(tokenize(''), []);
        assert.deepEqual(tokenize(null), []);
    });

    test('indexText 输出空格分隔的 token 串', () => {
        assert.equal(indexText('部署指南'), '部署 署指 指南');
    });
});

describe('MATCH 表达式', () => {
    test('FTS5 运算符被正确转义', () => {
        // 直接把用户输入塞进 MATCH 会因 - * " ( ) : ^ 等运算符抛语法错误
        const expr = buildMatchExpr('部署 -git');
        assert.ok(expr.includes('"部署"'));
        assert.ok(expr.includes('"git"'), '连字符不应被当作减号运算符');
    });

    test('引号不会进入 MATCH 表达式（分词阶段已当词边界消化）', () => {
        // 引号是 FTS5 的运算符，若原样进入 MATCH 会引发语法错误。
        // 但分词阶段就把它当词边界了：a"b → [a, b]，
        // 所以表达式里只会有普通 token，不需要额外转义。
        const expr = buildMatchExpr('a"b');
        assert.equal(expr, '"a" AND "b"');
        assert.ok(!expr.includes('""'), '表达式内不应残留裸引号');
    });

    test('空关键词返回 null', () => {
        assert.equal(buildMatchExpr(''), null);
        assert.equal(buildMatchExpr('   '), null);
    });
});

describe('搜索（FTS5）', () => {
    test('中文子串匹配：搜「部署」命中「部署指南」', () => {
        const db = makeDb();
        addDoc(db, '部署指南', '这里讲怎么部署服务');
        addDoc(db, '其他文档', '无关内容');
        const hits = searchTitles(db, '部署');
        assert.deepEqual(hits, ['部署指南'], '这正是 LIKE 做不到的');
        db.close();
    });

    test('中文子串匹配：搜「指南」命中「部署指南」', () => {
        const db = makeDb();
        addDoc(db, '部署指南', '正文');
        assert.deepEqual(searchTitles(db, '指南'), ['部署指南']);
        db.close();
    });

    test('英文整词匹配：搜「git」不误命中「digital」', () => {
        const db = makeDb();
        addDoc(db, 'Git 工作流', '介绍 git 的用法');
        addDoc(db, '数字转换', 'digital transform 说明');
        const hits = searchTitles(db, 'git');
        assert.deepEqual(hits, ['Git 工作流'], '英文必须按词边界匹配');
        db.close();
    });

    test('英文大小写不敏感', () => {
        const db = makeDb();
        addDoc(db, 'Deployment', 'x');
        assert.deepEqual(searchTitles(db, 'deployment'), ['Deployment']);
        assert.deepEqual(searchTitles(db, 'DEPLOYMENT'), ['Deployment']);
        db.close();
    });

    test('搜正文也能命中', () => {
        const db = makeDb();
        addDoc(db, '标题甲', '正文里提到了备份这个词');
        addDoc(db, '标题乙', '正文无关');
        assert.deepEqual(searchTitles(db, '备份'), ['标题甲']);
        db.close();
    });

    test('标题命中排在正文命中之前（相关性排序）', () => {
        const db = makeDb();
        // 「备份」在甲的标题里，在乙的正文里
        addDoc(db, '备份方案', '正文');
        addDoc(db, '别的文档', '这里也提了备份');
        const hits = searchTitles(db, '备份');
        assert.equal(hits[0], '备份方案', '标题命中应排前面');
        db.close();
    });

    test('无匹配返回空', () => {
        const db = makeDb();
        addDoc(db, '文档', '内容');
        const r = searchDocuments({ connection: db, keyword: '完全不存在的词' });
        assert.equal(r.total, 0);
        assert.deepEqual(r.items, []);
        db.close();
    });

    test('空关键词返回空', () => {
        const db = makeDb();
        addDoc(db, '文档', '内容');
        assert.equal(searchDocuments({ connection: db, keyword: '' }).total, 0);
        assert.equal(searchDocuments({ connection: db, keyword: '  ' }).total, 0);
        db.close();
    });

    test('结果附带摘要片段', () => {
        const db = makeDb();
        addDoc(db, '文档', '前面的内容 关键词 后面的内容');
        const r = searchDocuments({ connection: db, keyword: '关键词' });
        assert.ok(r.items[0].snippet.includes('关键词'));
        db.close();
    });
});

describe('索引同步', () => {
    test('新建文档立即可搜到', () => {
        const db = makeDb();
        addDoc(db, '新建的文档', '内容');
        assert.deepEqual(searchTitles(db, '新建'), ['新建的文档']);
        db.close();
    });

    test('更新文档后索引同步（旧的词搜不到，新的搜得到）', () => {
        const db = makeDb();
        const id = addDoc(db, '旧标题', '旧内容');
        assert.deepEqual(searchTitles(db, '旧标题'), ['旧标题']);

        const cur = db.prepare('SELECT version FROM documents WHERE id = ?').get(id);
        updateDocument({ connection: db, id, version: cur.version, title: '新标题', content_md: '新内容' });

        assert.deepEqual(searchTitles(db, '旧标题'), [], '旧内容不应再被搜到');
        assert.deepEqual(searchTitles(db, '新标题'), ['新标题']);
        db.close();
    });

    test('删除文档后索引清理', () => {
        const db = makeDb();
        const id = addDoc(db, '待删除', '内容');
        assert.equal(searchTitles(db, '待删除').length, 1);
        deleteDocument({ connection: db, id });
        assert.equal(searchTitles(db, '待删除').length, 0);
        db.close();
    });

    test('批量删除同时清理子孙页的索引', () => {
        const db = makeDb();
        const parent = addDoc(db, '父页面', '内容');
        const child = createDocument({ connection: db, title: '子页面', content_md: '内容', parent_id: parent }).id;
        assert.equal(searchTitles(db, '子页面').length, 1);

        deleteDocuments({ connection: db, ids: [parent] });

        assert.equal(searchTitles(db, '子页面').length, 0, '连带删除的子孙页索引也要清理');
        db.close();
    });

    test('索引与主表漂移时启动检查会重建', () => {
        const db = makeDb();
        addDoc(db, '甲', '内容');
        addDoc(db, '乙', '内容');
        // 人为破坏：清空索引
        db.exec('DELETE FROM documents_fts');

        const s = ensureIndexSynced(db);
        assert.equal(s.rebuilt, true, '应检测到漂移并重建');
        assert.equal(searchTitles(db, '甲').length, 1, '重建后应能搜到');
        db.close();
    });

    test('索引一致时不重建', () => {
        const db = makeDb();
        addDoc(db, '甲', '内容');
        const s = ensureIndexSynced(db);
        assert.equal(s.rebuilt, false);
        assert.equal(s.ok, true);
        db.close();
    });

    test('reindexAll 可手动全量重建', () => {
        const db = makeDb();
        addDoc(db, '甲', '内容');
        addDoc(db, '乙', '内容');
        db.exec('DELETE FROM documents_fts');
        const n = reindexAll(db);
        assert.equal(n, 2);
        assert.equal(searchTitles(db, '甲').length, 1);
        db.close();
    });
});
