// Vercel 函數：把頁面的提問和書頁相片轉交 AI，逐段串流答覆。
// 引擎次序：OpenRouter（OPENROUTER_API_KEY）→ GitHub Models（GITHUB_TOKEN，fine-grained token，只需 Models: Read）
// → Google Gemini（GEMINI_API_KEY）。另需 APP_PASSCODE（通行碼，防止別人用你的額度）。
// 金鑰設一個也可以；前一個出錯、額度用完或輸入太長，就自動改用下一個。
// 可選：OPENROUTER_MODELS（逗號分隔；預設 openrouter/free,google/gemma-4-31b-it:free）。
// 可選：GITHUB_MODELS（逗號分隔，按次序試；預設 openai/gpt-4.1,openai/o4-mini）；GITHUB_MODELS_URL（入口，逗號分隔）；
// GEMINI_MODEL（預設 gemini-3.8-pro,gemini-3.8-flash）；GEMINI_THINKING（LOW／MEDIUM／HIGH／XHIGH／OFF，預設 XHIGH）。
// 請求可加 search: true（新書推介）：要用 Google 搜尋，所以先用 Gemini，GitHub 做後備（後備沒有搜尋）。
// 回應格式：每行一個 JSON —— {"t": "文字"}，最後 {"done": true, "truncated": bool, "stop": "...", "sources": [...], "provider": "...", "model": "..."}，出錯時 {"error": "代碼"}。
import {GoogleGenAI, ApiError} from '@google/genai';

const GITHUB_URLS = 'https://models.github.ai/inference/chat/completions';
const GITHUB_DEFAULT = 'openai/gpt-4.1,openai/o4-mini';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_DEFAULT = 'openrouter/free,google/gemma-4-31b-it:free';
const GEMINI_DEFAULT = 'gemini-3.8-pro,gemini-3.8-flash';
const MAX_IMAGES = 4;
const MAX_PROMPT = 60000;
const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const BLOCKED = new Set(['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION', 'IMAGE_SAFETY', 'IMAGE_PROHIBITED_CONTENT']);

const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'}
});
const list = (v, d) => String(v || d).split(',').map(m => m.trim()).filter(Boolean);
const providers = () => [process.env.OPENROUTER_API_KEY ? 'openrouter' : '', process.env.GITHUB_TOKEN ? 'github' : '', process.env.GEMINI_API_KEY ? 'gemini' : ''].filter(Boolean);
const configured = () => !!(providers().length && process.env.APP_PASSCODE);

class ProviderError extends Error {
  constructor(code, status, detail) { super(code); this.code = code; this.status = status; this.detail = detail || ''; }
}
// 可以改用下一個型號／引擎的狀態：無權限、型號不存在、逾時、額度用完、伺服器出錯或太忙
const RETRYABLE = s => [403, 404, 408, 429, 500, 502, 503, 504].includes(s);
const short = m => String(m || '').replace(/\s+/g, ' ').slice(0, 160);

export function GET() {
  return json(200, {app: '睇書記錄', configured: configured(), maxImages: MAX_IMAGES, providers: providers()});
}

export async function POST(request) {
  if (!configured()) return json(503, {error: 'not_configured'});
  let body;
  try { body = await request.json(); } catch (e) { return json(400, {error: 'bad_request'}); }
  if (!body || String(body.pass || '').trim() !== process.env.APP_PASSCODE.trim()) return json(401, {error: 'bad_pass'});
  const prompt = typeof body.prompt === 'string' ? body.prompt : '';
  if (!prompt) return json(400, {error: 'bad_request'});
  if (prompt.length > MAX_PROMPT) return json(413, {error: 'prompt_too_large'});
  const images = Array.isArray(body.images) ? body.images : [];
  if (images.length > MAX_IMAGES) return json(413, {error: 'too_many_images'});
  for (const im of images) {
    if (!im || !TYPES.has(im.type) || typeof im.data !== 'string' || !im.data) return json(400, {error: 'image_rejected'});
  }
  const search = body.search === true;
  const order = providers().sort((a, b) => search ? (a === 'gemini' ? -1 : 1) - (b === 'gemini' ? -1 : 1) : 0);

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctl) {
      const send = o => ctl.enqueue(enc.encode(JSON.stringify(o) + '\n'));
      const fail = (e, p) => send({error: errorCode(e), detail: detailOf(e, p)});
      let last = null;
      const errs = [];
      // 按次序試每個引擎；未送出任何文字之前出錯，都改用下一個
      for (const p of order) {
        let opened, sent = false;
        try {
          opened = p === 'openrouter' ? await openOpenRouter(images, prompt, request.signal)
            : p === 'github' ? await openGithub(images, prompt, request.signal)
            : await openGemini(images, prompt, request.signal, search);
          for await (const ev of opened.events) {
            if (ev.t) { sent = true; send({t: ev.t}); }
            else if (ev.end) {
              if (ev.refused) send({error: 'refused', detail: p});
              else send({done: true, truncated: !!ev.truncated, stop: ev.stop || '', sources: ev.sources || [], provider: opened.name, model: opened.model});
            }
          }
          ctl.close(); return;
        } catch (e) {
          if (e && e.name === 'AbortError') { send({error: 'cancelled'}); ctl.close(); return; }
          if (sent) { fail(e, p); ctl.close(); return; }
          last = e; errs.push(detailOf(e, p));
        }
      }
      send({error: errorCode(last), detail: errs.join('；')});
      ctl.close();
    }
  });
  return new Response(stream, {headers: {'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store'}});
}

/* ---------- GitHub Models（OpenAI 格式的 chat completions，SSE 串流）---------- */
// 兩個入口按次序試：models.github.ai（型號名有 openai/ 前綴），舊入口 models.inference.ai.azure.com（型號名無前綴）
async function openGithub(images, prompt, signal) {
  const urls = list(process.env.GITHUB_MODELS_URL, GITHUB_URLS);
  const errs = [];
  for (const url of urls) {
    try { return await openGithubAt(url, images, prompt, signal); }
    catch (e) {
      if (e && e.name === 'AbortError') throw e;
      errs.push(e);
    }
  }
  const last = errs[errs.length - 1] || new ProviderError('upstream');
  throw new ProviderError(last.code || 'upstream', last.status, errs.map(e => e.detail || e.message).join(' ／ '));
}

async function openGithubAt(url, images, prompt, signal) {
  const host = new URL(url).host;
  const content = [
    ...images.map(im => ({type: 'image_url', image_url: {url: `data:${im.type};base64,${im.data}`}})),
    {type: 'text', text: prompt}
  ];
  let last = new ProviderError('upstream');
  for (const m of list(process.env.GITHUB_MODELS, GITHUB_DEFAULT)) {
    const model = /azure/i.test(url) ? m.replace(/^[^/]+\//, '') : m;
    let r, ct = '', txt = '', plain = false;
    // 先試串流；回覆不是答覆（例如純文字「OK」）就改用非串流再試一次
    for (const stream of [true, false]) {
      try {
        r = await postFollow(url, {
          authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
          'content-type': 'application/json',
          accept: stream ? 'text/event-stream' : 'application/json',
          'x-github-api-version': '2022-11-28',
          'user-agent': 'reading-log'
        }, JSON.stringify({model, stream, messages: [{role: 'user', content}]}), signal);
      } catch (e) {
        if (e && e.name === 'AbortError') throw e;
        r = null; last = new ProviderError('network', 0, `${host} ${short(e && e.message)}`);
        break;
      }
      ct = r.headers.get('content-type') || '';
      if (r.ok && r.body && /event-stream|json/i.test(ct)) return {name: 'github', model, events: chatEvents(r, 'github')};
      txt = await r.text().catch(() => '');
      plain = r.ok;
      if (!plain) break;
    }
    if (!r) continue;
    if (plain) { last = new ProviderError('upstream', r.status, `${host} ${model} 回覆不是答覆（${ct}）${short(txt)}`); continue; }
    last = new ProviderError(
      r.status === 401 || r.status === 403 ? 'server_key'
        : r.status === 429 ? 'rate_limited'
        : r.status === 413 || /token.*(limit|large)|too large/i.test(txt) ? 'prompt_too_large'
        : r.status === 400 && /image/i.test(txt) ? 'image_rejected'
        : 'upstream', r.status, `${host} ${model} ${innerMessage(txt)}`);
  }
  throw last;
}

// 跟隨轉址時保持 POST 和內容（fetch 遇到 301／302 會改成 GET，只會拿到「OK」）
async function postFollow(url, headers, body, signal) {
  let u = url;
  for (let i = 0; i < 4; i++) {
    const r = await fetch(u, {method: 'POST', headers, body, signal, redirect: 'manual'});
    const loc = r.headers.get('location');
    if (r.status >= 300 && r.status < 400 && loc) { await r.body?.cancel().catch(() => {}); u = new URL(loc, u).toString(); continue; }
    return r;
  }
  throw new ProviderError('upstream', 0, 'github 轉址太多次');
}

/* ---------- OpenRouter（OpenAI 格式，SSE 串流；香港免 VPN，由 Vercel 伺服器連線）---------- */
async function openOpenRouter(images, prompt, signal) {
  const url = process.env.OPENROUTER_URL || OPENROUTER_URL;
  const content = [
    ...images.map(im => ({type: 'image_url', image_url: {url: `data:${im.type};base64,${im.data}`}})),
    {type: 'text', text: prompt}
  ];
  const errs = [];
  let code = 'upstream';
  for (const model of list(process.env.OPENROUTER_MODELS, OPENROUTER_DEFAULT)) {
    let r;
    try {
      r = await fetch(url, {
        method: 'POST', signal,
        headers: {
          authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'content-type': 'application/json',
          accept: 'text/event-stream',
          'x-title': 'Reading Log'
        },
        body: JSON.stringify({model, stream: true, messages: [{role: 'user', content}]})
      });
    } catch (e) {
      if (e && e.name === 'AbortError') throw e;
      errs.push(`${model} ${short(e && e.message)}`); code = 'network';
      continue;
    }
    const ct = r.headers.get('content-type') || '';
    if (r.ok && r.body && /event-stream|json/i.test(ct)) return {name: 'openrouter', model, events: chatEvents(r, 'openrouter')};
    const txt = await r.text().catch(() => '');
    code = r.status === 401 || r.status === 403 ? 'server_key'
      : r.status === 402 || r.status === 429 ? 'rate_limited'
      : r.status === 413 || /token.*(limit|large)|context length/i.test(txt) ? 'prompt_too_large'
      : r.status === 400 && /image/i.test(txt) ? 'image_rejected'
      : 'upstream';
    errs.push(`${model} ${r.status} ${innerMessage(txt)}`);
  }
  throw new ProviderError(code, 0, errs.join(' ／ '));
}

async function* chatEvents(r, name) {
  const rd = r.body.getReader(), dec = new TextDecoder();
  let buf = '', finish = '', raw = '', got = false;
  const handle = function* (line) {
    line = line.trim();
    if (raw.length < 2000) raw += line + '\n';
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return;
    let j;
    try { j = JSON.parse(data); } catch (e) { return; }
    if (j.error) throw new ProviderError(j.error.code === 'content_filter' ? 'refused' : 'upstream', 0, short(j.error.message || j.error.code));
    const c = j.choices && j.choices[0];
    if (!c) return;
    if (c.delta && typeof c.delta.content === 'string' && c.delta.content) { got = true; yield {t: c.delta.content}; }
    if (c.finish_reason) finish = c.finish_reason;
  };
  for (;;) {
    const {value, done} = await rd.read();
    if (done) break;
    buf += dec.decode(value, {stream: true});
    let k;
    while ((k = buf.indexOf('\n')) >= 0) { yield* handle(buf.slice(0, k)); buf = buf.slice(k + 1); }
  }
  yield* handle(buf);
  if (!got) {
    // 不是 SSE：可能是一次過的 JSON（非串流答覆或錯誤）
    let j = null;
    try { j = JSON.parse(raw); } catch (e) {}
    const c = j && j.choices && j.choices[0];
    const text = c && c.message && typeof c.message.content === 'string' ? c.message.content : '';
    if (text) { yield {t: text}; finish = c.finish_reason || finish; }
    else if (finish !== 'content_filter') throw new ProviderError('upstream', 0, `${name} 沒有回覆內容（${r.status} ${r.headers.get('content-type') || ''} ${r.url || ''}）` + innerMessage(raw));
  }
  yield {end: true, truncated: finish === 'length', refused: finish === 'content_filter', stop: finish};
}

/* ---------- Google Gemini ---------- */
async function openGemini(images, prompt, signal, search) {
  const opts = {apiKey: process.env.GEMINI_API_KEY};
  if (process.env.GEMINI_BASE_URL) opts.httpOptions = {baseUrl: process.env.GEMINI_BASE_URL};
  const ai = new GoogleGenAI(opts);
  const parts = [...images.map(im => ({inlineData: {mimeType: im.type, data: im.data}})), {text: prompt}];
  const level = (process.env.GEMINI_THINKING || 'XHIGH').trim().toUpperCase();
  let last;
  // 按次序試每個模型：型號不存在、無權限或額度用完（404／403／429）就試下一個；
  // 不接受指定思考深度（400）就用該模型預設再試一次。
  for (const model of list(process.env.GEMINI_MODEL, GEMINI_DEFAULT)) {
    const config = {maxOutputTokens: 32000, abortSignal: signal};
    if (level !== 'OFF') config.thinkingConfig = {thinkingLevel: level};
    if (search) config.tools = [{googleSearch: {}}];
    for (;;) {
      try {
        const res = await ai.models.generateContentStream({model, contents: [{role: 'user', parts}], config});
        return {name: 'gemini', model, events: geminiEvents(res)};
      } catch (e) {
        last = e;
        if (!(e instanceof ApiError)) throw e;
        if (e.status === 400 && config.thinkingConfig && /think/i.test(e.message || '')) { delete config.thinkingConfig; continue; }
        if (RETRYABLE(e.status)) break;
        throw e;
      }
    }
  }
  throw last;
}

async function* geminiEvents(res) {
  let finish = '', blocked = '', got = false;
  const sources = new Map();
  for await (const chunk of res) {
    if (chunk.promptFeedback && chunk.promptFeedback.blockReason) blocked = chunk.promptFeedback.blockReason;
    const c = chunk.candidates && chunk.candidates[0];
    if (c && c.finishReason) finish = c.finishReason;
    for (const g of (c && c.groundingMetadata && c.groundingMetadata.groundingChunks) || []) {
      if (g.web && g.web.uri && !sources.has(g.web.uri) && sources.size < 20) sources.set(g.web.uri, {title: g.web.title || g.web.uri, uri: g.web.uri});
    }
    const t = chunk.text;
    if (t) { got = true; yield {t}; }
  }
  if (!got && !blocked && !BLOCKED.has(finish)) throw new ProviderError('upstream', 0, 'gemini 沒有回覆內容 ' + finish);
  yield {end: true, truncated: finish === 'MAX_TOKENS', refused: !!blocked || BLOCKED.has(finish), stop: finish, sources: [...sources.values()]};
}

// 從（可能多層包住的）JSON 錯誤字串抽出最內層的 message
function innerMessage(m) {
  let t = String(m || '');
  for (let i = 0; i < 4; i++) {
    const k = t.indexOf('{');
    if (k < 0) break;
    try {
      const j = JSON.parse(t.slice(k));
      const msg = (j.error && (j.error.message || j.error.code)) || j.message;
      if (!msg || typeof msg !== 'string') break;
      t = msg;
    } catch (e) {
      const mm = /"message"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(t);
      if (mm) t = mm[1].replace(/\\n/g, ' ').replace(/\\"/g, '"');
      break;
    }
  }
  return t;
}

function detailOf(e, p) {
  if (!e) return p || '';
  const st = e.status ? ' ' + e.status : '';
  return short(`${p || ''}${st} ${innerMessage(e.detail || e.message || '')}`).trim();
}

function errorCode(e) {
  if (!e) return 'upstream';
  if (e.name === 'AbortError') return 'cancelled';
  if (e instanceof ProviderError) return e.code;
  if (e instanceof ApiError) {
    if (e.status === 400 && /api key/i.test(e.message || '')) return 'server_key';
    if (e.status === 401 || e.status === 403) return 'server_key';
    if (e.status === 429) return 'rate_limited';
    if (e.status === 400) return /image|mime/i.test(e.message || '') ? 'image_rejected' : 'bad_request';
    return 'upstream';
  }
  return 'network';
}
