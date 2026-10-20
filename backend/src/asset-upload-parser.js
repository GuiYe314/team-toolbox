// 资源管理的 multipart 解析：文件 + 文本字段。
//
// 为什么不直接用 uploads.js 的 parseUploadFile：
//   那个函数只关心文件本体（Markdown 图片场景只需 image 一个字段），
//   busboy 的 text 事件被完全忽略。而资源上传需要同时携带
//   folderId / tags / description / comment / assetId 等表单字段，
//   express.json() 中间件不解析 multipart，所以这些字段无处可取。
//
// 这里复用 uploads.js 的错误码与体积上限约定，但补齐 text 收集。

import Busboy from 'busboy';
import { errorMap } from './errors.js';

/** 单个文本字段的体积上限，防止把内存打满（description 之类的字段不需要很大）。 */
const MAX_FIELD_BYTES = 64 * 1024;

/**
 * 解析 multipart/form-data，返回文件与全部文本字段。
 *
 * @param {import('express').Request} req
 * @param {number} maxBytes 文件体积上限
 * @returns {Promise<{ buffer: Buffer|null, filename: string, fields: Record<string,string> } | null>}
 *   无 file 字段时返回 { buffer: null, filename: '', fields }
 */
export function parseUploadWithFields(req, maxBytes) {
    return new Promise((resolvePromise, rejectPromise) => {
        let bb;
        try {
            bb = Busboy({ headers: req.headers, limits: { fileSize: maxBytes, files: 1 } });
        } catch {
            rejectPromise(errorMap(
                new Error('请求不是有效的 multipart/form-data'), '(assets)', 'invalid_input'
            ));
            return;
        }

        let done = false;
        const fail = (err) => {
            if (done) return;
            done = true;
            req.unpipe(bb);
            rejectPromise(err);
        };
        const finish = (value) => {
            if (done) return;
            done = true;
            resolvePromise(value);
        };

        const chunks = [];
        const fields = {};
        let filename = '';
        let got = false;
        let truncated = false;

        // 文本字段。busboy 的 text 事件在 file 之前或之后都可能触发，
        // 所以必须等到 close 才能确认字段已全部收齐。
        bb.on('field', (name, value) => {
            fields[name] = String(value);
        });

        bb.on('file', (_field, stream, info) => {
            got = true;
            filename = info && info.filename ? info.filename : '';
            stream.on('data', (c) => chunks.push(c));
            stream.on('limit', () => {
                truncated = true;
                fail(errorMap(
                    new Error(`文件超出上限 ${Math.floor(maxBytes / 1024 / 1024 / 1024)}GB`),
                    '(assets)', 'invalid_input'
                ));
            });
            stream.on('error', (e) => fail(e));
        });

        bb.on('error', (e) => fail(errorMap(e, '(assets)', 'invalid_input')));

        bb.on('close', () => {
            if (truncated) return;
            if (!got) finish({ buffer: null, filename: '', fields });
            else finish({ buffer: Buffer.concat(chunks), filename, fields });
        });

        req.pipe(bb);
    });
}