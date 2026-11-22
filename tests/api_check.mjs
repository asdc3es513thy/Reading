// 測試 api/ask.js：用本機假 GitHub Models 和假 Gemini 伺服器（SSE），不會真正呼叫任何 AI、不花額度。
// 由 tests/test_local.py 執行；輸出 JSON 結果。
import http from 'node:http';

const seen = [];
let mode = 'ok';
const chunk = (text, finishReason) => `data: ${JSON.stringify({candidates: [{content: {role: 'model', parts: [{text}]}, ...(finishReason ? {finishReason} : {})}]})}\r\n\r\n`;
const fake = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    seen.push({path: req.url, body: JSON.parse(body || '{}'), key: req.headers['x-goog-api-key'] || '', auth: req.headers.authorization || ''});
    if (req.url.startsWith('/inference/')) {
      if (mode === 'alldown') { res.writeHead(500, {'content-type': 'application/json'}); return res.end('{"error":{"message":"internal error"}}'); }
      if (mode === 'ghempty') {
        res.writeHead(200, {'content-type': 'text/event-stream'});
        res.write(`data: ${JSON.stringify({choices: [{index: 0, delta: {}, finish_reason: 'stop'}]})}\n\ndata: [DONE]\n\n`);
        return res.end();
      }
      if (mode === 'ghjson') {
        res.writeHead(200, {'content-type': 'application/json'});
        return res.end(JSON.stringify({choices: [{index: 0, message: {role: 'assistant', content: '書名：《JSON》'}, finish_reason: 'stop'}]}));
      }
      if (mode === 'ghstreamerr') {
        res.writeHead(200, {'content-type': 'text/event-stream'});
        res.write(`data: ${JSON.stringify({error: {code: 'server_error', message: 'stream failed'}})}\n\n`);
        return res.end();
      }
      if (mode === 'gh429') { res.writeHead(429, {'content-type': 'application/json'}); return res.end('{"error":{"code":"RateLimitReached"}}'); }
      res.writeHead(200, {'content-type': 'text/event-stream'});
      const d = (content, finish_reason = null) => `data: ${JSON.stringify({choices: [{index: 0, delta: content ? {content} : {}, finish_reason}]})}\n\n`;
      res.write(d('書名：《GH》\n'));
      res.write(d('【核對】甲。'));
      res.write(d('', mode === 'ghlen' ? 'length' : mode === 'ghfilter' ? 'content_filter' : 'stop'));
      res.write('data: [DONE]\n\n');
      return res.end();
    }
    if (mode === 'quota' && !req.url.startsWith('/inference/')) {
      res.writeHead(429, {'content-type': 'application/json'});
      return res.end(JSON.stringify({error: {code: 429, message: 'You exceeded your current quota, please check your plan.', status: 'RESOURCE_EXHAUSTED'}}));
    }
    if (mode === 'alldown' || (mode === 'pro503' && req.url.includes('gemini-3.8-pro'))) {
      res.writeHead(503, {'content-type': 'application/json'});
      return res.end(JSON.stringify({error: {code: 503, message: 'The model is overloaded. Please try again later.', status: 'UNAVAILABLE'}}));
    }
    if (mode === 'nopro' && req.url.includes('gemini-3.8-pro')) {
      res.writeHead(404, {'content-type': 'application/json'});
      return res.end(JSON.stringify({error: {code: 404, message: 'models/gemini-3.8-pro is not found', status: 'NOT_FOUND'}}));
    }
    if (mode === 'nothink' && JSON.parse(body).generationConfig?.thinkingConfig) {
      res.writeHead(400, {'content-type': 'application/json'});
      return res.end(JSON.stringify({error: {code: 400, message: 'thinking_level is not supported by this model', status: 'INVALID_ARGUMENT'}}));
    }
    res.writeHead(200, {'content-type': 'text/event-stream'});
    if (mode === 'blocked') { res.write(chunk('', 'SAFETY')); return res.end(); }
    if (mode === 'search') {
      res.write(`data: ${JSON.stringify({candidates: [{content: {role: 'model', parts: [{text: '書名：新書'}]}, finishReason: 'STOP',
        groundingMetadata: {groundingChunks: [{web: {uri: 'https://example.com/a', title: 'A'}}, {web: {uri: 'https://example.com/a', title: 'A'}}]}}]})}\r\n\r\n`);
      return res.end();
    }
    res.write(chunk('書名：《測試》\n'));
    res.write(chunk('【核對】一。', mode === 'long' ? 'MAX_TOKENS' : 'STOP'));
    res.end();
  });
});
await new Promise(r => fake.listen(0, '127.0.0.1', r));
process.env.GEMINI_BASE_URL = `http://127.0.0.1:${fake.address().port}`;

const out = {};
const api = await import('../api/ask.js');
const post = body => api.POST(new Request('http://x/api/ask', {method: 'POST', body: JSON.stringify(body)}));

delete process.env.GEMINI_API_KEY; delete process.env.APP_PASSCODE;
out.unconfiguredGet = (await api.GET().json()).configured;
out.unconfiguredPost = (await post({pass: 'x', prompt: 'p'})).status;

process.env.GEMINI_API_KEY = 'test-key'; process.env.APP_PASSCODE = ' secret\n';
out.configuredGet = (await api.GET().json()).configured;
out.wrongPass = (await post({pass: 'nope', prompt: 'p'})).status;
out.noPrompt = (await post({pass: 'secret', prompt: ''})).status;
out.tooMany = (await post({pass: 'secret', prompt: 'p', images: Array(5).fill({type: 'image/png', data: 'AA=='})})).status;
out.badType = (await post({pass: 'secret', prompt: 'p', images: [{type: 'image/gif', data: 'AA=='}]})).status;

const r = await post({pass: 'secret', prompt: '提問', images: [{type: 'image/png', data: 'AAAA'}]});
out.okStatus = r.status;
out.lines = (await r.text()).trim().split('\n').map(l => JSON.parse(l));
const req = seen[0] || {body: {}};
out.path = req.path;
out.key = req.key;
out.parts = (req.body.contents || [{}])[0].parts;
out.config = req.body.generationConfig;
mode = 'long';
out.long = (await (await post({pass: 'secret', prompt: 'p'})).text()).trim().split('\n').map(l => JSON.parse(l)).pop();
mode = 'nothink';
out.nothink = (await (await post({pass: 'secret', prompt: 'p'})).text()).trim().split('\n').map(l => JSON.parse(l)).pop();
mode = 'nopro';
const before = seen.length;
out.nopro = (await (await post({pass: 'secret', prompt: 'p'})).text()).trim().split('\n').map(l => JSON.parse(l)).pop();
out.noproPaths = seen.slice(before).map(x => x.path);
mode = 'pro503';
out.pro503 = (await (await post({pass: 'secret', prompt: 'p'})).text()).trim().split('\n').map(l => JSON.parse(l)).pop();
mode = 'search';
const b2 = seen.length;
out.search = (await (await post({pass: 'secret', prompt: 'p', search: true})).text()).trim().split('\n').map(l => JSON.parse(l)).pop();
out.searchTools = seen[b2].body.tools;
out.plainTools = seen[0].body.tools || null;
mode = 'blocked';
out.blocked = (await (await post({pass: 'secret', prompt: 'p'})).text()).trim().split('\n').map(l => JSON.parse(l)).pop();

// ---- GitHub Models 做主引擎，Gemini 做後備 ----
const last = async b => (await (await post(b)).text()).trim().split('\n').map(l => JSON.parse(l));
process.env.GITHUB_TOKEN = 'gh-test'; process.env.GITHUB_MODELS_URL = `http://127.0.0.1:${fake.address().port}/inference/chat/completions`;
out.ghGet = await api.GET().json();
mode = 'gh';
let b3 = seen.length;
out.gh = await last({pass: 'secret', prompt: '提問', images: [{type: 'image/png', data: 'AAAA'}]});
out.ghReq = seen.slice(b3).map(x => ({path: x.path, auth: x.auth, model: x.body.model, stream: x.body.stream, content: x.body.messages && x.body.messages[0].content}));
mode = 'gh429';
b3 = seen.length;
out.ghFallback = (await last({pass: 'secret', prompt: 'p'})).pop();
out.ghFallbackPaths = seen.slice(b3).map(x => x.path.split('?')[0]);
mode = 'ghlen';
out.ghLen = (await last({pass: 'secret', prompt: 'p'})).pop();
mode = 'ghfilter';
out.ghFilter = (await last({pass: 'secret', prompt: 'p'})).pop();
mode = 'search';
b3 = seen.length;
out.searchBoth = (await last({pass: 'secret', prompt: 'p', search: true})).pop();
out.searchBothFirst = seen[b3].path.split('?')[0];
mode = 'ghstreamerr';
out.ghStreamErr = (await last({pass: 'secret', prompt: 'p'})).pop();
mode = 'ghempty';
out.ghEmpty = (await last({pass: 'secret', prompt: 'p'})).pop();
mode = 'ghjson';
out.ghJson = await last({pass: 'secret', prompt: 'p'});
mode = 'alldown';
out.allDown = (await last({pass: 'secret', prompt: 'p'})).pop();
delete process.env.GITHUB_TOKEN;
mode = 'quota';
out.quota = (await last({pass: 'secret', prompt: 'p'})).pop();
process.env.GITHUB_TOKEN = 'gh-test';
delete process.env.GEMINI_API_KEY;
out.ghOnlyGet = (await api.GET().json()).providers;

fake.close();
console.log(JSON.stringify(out));
