// 用户正则在独立 Worker 中执行，主页面可以超时终止灾难性回溯。
self.onmessage = ({ data }) => {
    try {
        const regex = new RegExp(data.pattern, data.flags), matches = [];
        for (const match of data.text.matchAll(regex)) {
            matches.push({ index: match.index, text: match[0].slice(0, 2000), groups: match.slice(1, 21) });
            if (matches.length >= 500) break;
        }
        self.postMessage({ matches });
    } catch (error) { self.postMessage({ error: error.message }); }
};
