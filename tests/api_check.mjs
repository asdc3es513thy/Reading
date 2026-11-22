// 測試 api/ask.js：用本機假 Gemini 伺服器（SSE），不會真正呼叫 Gemini、不花額度。
// 由 tests/test_local.py 執行；輸出 JSON 結果。
import http from 'node:http';

const seen = [];
let mode = 'ok';
const chunk = (text, finishReason) => `data: ${JSON.stringify({candidates: [{content: {role: 'model', parts: [{text}]}, ...(finishReason ? {finishReason} : {})}]})}\r\n\r\n`;
const fake = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    seen.push({path: req.url, body: JSON.parse(body || '{}'), key: req.headers['x-goog-api-key'] || ''});
    if (mode === 'nothink' && JSON.parse(body).generationConfig?.thinkingConfig) {
      res.writeHead(400, {'content-type': 'application/json'});
      return res.end(JSON.stringify({error: {code: 400, message: 'thinking_level is not supported by this model', status: 'INVALID_ARGUMENT'}}));
    }
    res.writeHead(200, {'content-type': 'text/event-stream'});
    if (mode === 'blocked') { res.write(chunk('', 'SAFETY')); return res.end(); }
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
mode = 'blocked';
out.blocked = (await (await post({pass: 'secret', prompt: 'p'})).text()).trim().split('\n').map(l => JSON.parse(l)).pop();

fake.close();
console.log(JSON.stringify(out));
