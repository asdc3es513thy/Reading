// 測試 api/ask.js：用本機假 Anthropic 伺服器（SSE），不會真正呼叫 Claude、不花額度。
// 由 tests/test_local.py 執行；輸出 JSON 結果。
import http from 'node:http';

const seen = [];
const sse = (type, data) => `event: ${type}\ndata: ${JSON.stringify({type, ...data})}\n\n`;
const fake = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    seen.push({path: req.url, body: JSON.parse(body || '{}'), beta: req.headers['anthropic-beta'] || ''});
    res.writeHead(200, {'content-type': 'text/event-stream'});
    const msg = {id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null,
      usage: {input_tokens: 1, output_tokens: 0}};
    res.write(sse('message_start', {message: msg}));
    res.write(sse('content_block_start', {index: 0, content_block: {type: 'text', text: ''}}));
    for (const t of ['書名：《測試》\n', '【核對】一。']) res.write(sse('content_block_delta', {index: 0, delta: {type: 'text_delta', text: t}}));
    res.write(sse('content_block_stop', {index: 0}));
    res.write(sse('message_delta', {delta: {stop_reason: 'end_turn', stop_sequence: null}, usage: {output_tokens: 5}}));
    res.write(sse('message_stop', {}));
    res.end();
  });
});
await new Promise(r => fake.listen(0, '127.0.0.1', r));
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${fake.address().port}`;

const out = {};
const api = await import('../api/ask.js');
const post = body => api.POST(new Request('http://x/api/ask', {method: 'POST', body: JSON.stringify(body)}));

delete process.env.ANTHROPIC_API_KEY; delete process.env.APP_PASSCODE;
out.unconfiguredGet = (await api.GET().json()).configured;
out.unconfiguredPost = (await post({pass: 'x', prompt: 'p'})).status;

process.env.ANTHROPIC_API_KEY = 'test-key'; process.env.APP_PASSCODE = 'secret';
out.configuredGet = (await api.GET().json()).configured;
out.wrongPass = (await post({pass: 'nope', prompt: 'p'})).status;
out.noPrompt = (await post({pass: 'secret', prompt: ''})).status;
out.tooMany = (await post({pass: 'secret', prompt: 'p', images: Array(5).fill({type: 'image/png', data: 'AA=='})})).status;
out.badType = (await post({pass: 'secret', prompt: 'p', images: [{type: 'image/gif', data: 'AA=='}]})).status;

const r = await post({pass: 'secret', prompt: '提問', images: [{type: 'image/png', data: 'AAAA'}]});
out.okStatus = r.status;
out.lines = (await r.text()).trim().split('\n').map(l => JSON.parse(l));
const req = seen[0] || {body: {}};
out.model = req.body.model;
out.fallbacks = req.body.fallbacks;
out.beta = req.beta;
out.content = (req.body.messages || [{}])[0].content;

fake.close();
console.log(JSON.stringify(out));
