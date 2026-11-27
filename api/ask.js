// Vercel 函數：把頁面的提問和書頁相片轉交 AI，逐段串流答覆。
// 引擎次序（預設）：Google Gemini（GEMINI_API_KEY）→ OpenRouter（OPENROUTER_API_KEY）→ Mistral（MISTRAL_API_KEY）；可用 ENGINE_ORDER 改（例如 openrouter,mistral,gemini）。
// 另需 APP_PASSCODE（通行碼，防止別人用你的額度）。金鑰設一個也可以；前一個出錯、額度用完或輸入太長，就自動改用下一個。
// 每個引擎都要求最高推理深度；中國公司的模型（含以其為底的衍生模型）一律不用，即使環境變數列了也會略過。
// 可選：OPENROUTER_MODELS（逗號分隔；預設 Nemotron 3.5 Super VL → Gemma 4 31B → Nemotron 3 Ultra，全部免費）；
// MISTRAL_MODELS（預設 mistral-large-4-0,mistral-medium-3-5）；
// GEMINI_MODEL（預設 gemini-3.1-pro-preview,gemini-3.8-flash：Pro 額度用完、太忙或不存在就改用 Flash）；GEMINI_THINKING（LOW／MEDIUM／HIGH／XHIGH／OFF，預設 XHIGH）。
// 請求可加 light: true（全書整理等排版工作）：Gemini 略過 Pro 型號，留額度給篩書和核對。
// 請求可加 search: true（篩書、核對、新書推介）：用 Gemini 的 Google 搜尋，所以先用 Gemini；後備沒有搜尋，提問前會加註說明。
// done 另有 skipped：答覆前試過但用不到的引擎／型號及原因，方便看出 Gemini Pro 為何沒有用到。
// 回應格式：每行一個 JSON —— {"t": "文字"}，最後 {"done": true, "truncated": bool, "stop": "...", "sources": [...], "provider": "...", "model": "..."}，出錯時 {"error": "代碼"}。
import {GoogleGenAI, ApiError} from '@google/genai';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_DEFAULT = 'nvidia/nemotron-3.5-super-vl:free,google/gemma-4-31b-it:free,nvidia/nemotron-3-ultra-550b-a55b:free';
const MISTRAL_URL = 'https://api.mistral.ai/v1/chat/completions';
const MISTRAL_DEFAULT = 'mistral-large-4-0,mistral-medium-3-5';
const GEMINI_DEFAULT = 'gemini-3.1-pro-preview,gemini-3.8-flash';
const ORDER_DEFAULT = 'gemini,openrouter,mistral';
const NO_SEARCH = '（系統註：這次未能使用網上搜尋。提問中要求搜尋的部分，改用圖中資料和模型記憶，並標明「模型記憶，未查證」；不要假裝查過。）\n\n';
const MAX_IMAGES = 4;
const MAX_PROMPT = 60000;
const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const BLOCKED = new Set(['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION', 'IMAGE_SAFETY', 'IMAGE_PROHIBITED_CONTENT']);

const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'}
});
const list = (v, d) => String(v || d).split(',').map(m => m.trim()).filter(Boolean);
// 中國公司的模型及其衍生模型；openrouter/free、openrouter/auto 會隨機路由到它們，所以也排除
const CHINESE = /(^|[/:])(deepseek|qwen|qwq|alibaba|ali-|z-ai|zai|glm|thudm|zhipu|chatglm|moonshot|kimi|minimax|baidu|ernie|tencent|hunyuan|bytedance|seed|doubao|stepfun|step-?\d|inclusionai|ling-|ring-|xiaomi|mimo|meituan|longcat|kwaipilot|kwai|kling|01-ai|yi-|internlm|intern-|shanghai|baichuan|iflytek|spark-|xingchen|telechat|dots|rednote|xiaohongshu|particle-ai|sensetime|sensenova|skywork|kunlun|openbmb|minicpm|huawei|pangu|ant-|bailing|openrouter\/(free|auto)$)/i;
const models = (v, d) => list(v, d).filter(m => !CHINESE.test(m));
const KEYS = {gemini: 'GEMINI_API_KEY', openrouter: 'OPENROUTER_API_KEY', mistral: 'MISTRAL_API_KEY'};
// 有金鑰的引擎，按 ENGINE_ORDER（預設 Gemini 先）排列；次序沒列到的引擎排最後
const providers = () => {
  const want = list(process.env.ENGINE_ORDER, ORDER_DEFAULT).map(x => x.toLowerCase()).filter(x => KEYS[x]);
  return [...new Set([...want, ...Object.keys(KEYS)])].filter(p => process.env[KEYS[p]]);
};
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
  const search = body.search === true, light = body.light === true;
  const order = providers().sort((a, b) => search ? (a === 'gemini' ? -1 : 1) - (b === 'gemini' ? -1 : 1) : 0);

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctl) {
      const send = o => ctl.enqueue(enc.encode(JSON.stringify(o) + '\n'));
      const fail = (e, p) => send({error: errorCode(e), detail: detailOf(e, p)});
      let last = null;
      const errs = [], skips = [];
      // 按次序試每個引擎；未送出任何文字之前出錯，都改用下一個
      for (const p of order) {
        let opened, sent = false;
        try {
          opened = p === 'openrouter' ? await openOpenRouter(images, search ? NO_SEARCH + prompt : prompt, request.signal)
            : p === 'mistral' ? await openMistral(images, search ? NO_SEARCH + prompt : prompt, request.signal)
            : await openGemini(images, prompt, request.signal, search, light);
          for await (const ev of opened.events) {
            if (ev.t) { sent = true; send({t: ev.t}); }
            else if (ev.end) {
              if (ev.refused) send({error: 'refused', detail: p});
              else send({done: true, truncated: !!ev.truncated, stop: ev.stop || '', sources: ev.sources || [], provider: opened.name, model: opened.model, skipped: [...skips, ...(opened.skipped || [])]});
            }
          }
          ctl.close(); return;
        } catch (e) {
          if (e && e.name === 'AbortError') { send({error: 'cancelled'}); ctl.close(); return; }
          if (sent) { fail(e, p); ctl.close(); return; }
          last = e; errs.push(detailOf(e, p));
          skips.push(...(e && e.skipped && e.skipped.length ? e.skipped : [detailOf(e, p)]));
        }
      }
      send({error: errorCode(last), detail: errs.join('；')});
      ctl.close();
    }
  });
  return new Response(stream, {headers: {'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store'}});
}

/* ---------- OpenAI 格式的 chat completions（OpenRouter、Mistral），SSE 串流 ---------- */
// OpenRouter：香港免 VPN，由 Vercel 伺服器連線；reasoning.effort = high（最高推理深度）。
function openOpenRouter(images, prompt, signal) {
  return openChat('openrouter', process.env.OPENROUTER_URL || OPENROUTER_URL, process.env.OPENROUTER_API_KEY,
    models(process.env.OPENROUTER_MODELS, OPENROUTER_DEFAULT), images, prompt, signal,
    {'x-title': 'Reading Log'}, {reasoning: {effort: 'high'}});
}
// Mistral：reasoning_effort = high（Large 4、Medium 3.5 都接受）；思考過程以 thinking 區塊分開送出，不會混入答覆。
function openMistral(images, prompt, signal) {
  return openChat('mistral', process.env.MISTRAL_URL || MISTRAL_URL, process.env.MISTRAL_API_KEY,
    models(process.env.MISTRAL_MODELS, MISTRAL_DEFAULT), images, prompt, signal,
    {}, {reasoning_effort: 'high'});
}

async function openChat(name, url, key, list, images, prompt, signal, headers, deep) {
  const content = [
    ...images.map(im => ({type: 'image_url', image_url: {url: `data:${im.type};base64,${im.data}`}})),
    {type: 'text', text: prompt}
  ];
  const errs = [];
  let code = 'upstream';
  if (!list.length) throw new ProviderError('upstream', 0, `${name} 沒有可用模型（中國模型已排除）`);
  for (const model of list) {
    // 先要求最高推理深度；模型不接受（400 並提及 reasoning）就用預設再試一次
    for (const extra of [deep, {}]) {
      let r;
      try {
        r = await fetch(url, {
          method: 'POST', signal,
          headers: {authorization: `Bearer ${key}`, 'content-type': 'application/json', accept: 'text/event-stream', ...headers},
          body: JSON.stringify({model, stream: true, messages: [{role: 'user', content}], ...extra})
        });
      } catch (e) {
        if (e && e.name === 'AbortError') throw e;
        errs.push(`${model} ${short(e && e.message)}`); code = 'network';
        break;
      }
      const ct = r.headers.get('content-type') || '';
      if (r.ok && r.body && /event-stream|json/i.test(ct)) return {name, model, events: chatEvents(r, name)};
      const txt = await r.text().catch(() => '');
      if (r.status === 400 && Object.keys(extra).length && /reason|think|effort/i.test(txt)) continue;
      code = r.status === 401 || r.status === 403 ? 'server_key'
        : r.status === 402 || r.status === 429 ? 'rate_limited'
        : r.status === 413 || /token.*(limit|large)|context length|too large/i.test(txt) ? 'prompt_too_large'
        : r.status === 400 && /image/i.test(txt) ? 'image_rejected'
        : 'upstream';
      errs.push(`${model} ${r.status} ${innerMessage(txt)}`);
      break;
    }
  }
  throw new ProviderError(code, 0, errs.join(' ／ '));
}

// 只取答覆文字：content 可能是字串，也可能是區塊陣列（Mistral 推理模式：thinking 區塊略過，只取 text）
const textOf = c => typeof c === 'string' ? c
  : Array.isArray(c) ? c.map(x => x && x.type === 'text' && typeof x.text === 'string' ? x.text : '').join('') : '';

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
    const t = c.delta ? textOf(c.delta.content) : '';
    if (t) { got = true; yield {t}; }
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
    const text = c && c.message ? textOf(c.message.content) : '';
    if (text) { yield {t: text}; finish = c.finish_reason || finish; }
    else if (finish !== 'content_filter') throw new ProviderError('upstream', 0, `${name} 沒有回覆內容（${r.status} ${r.headers.get('content-type') || ''} ${r.url || ''}）` + innerMessage(raw));
  }
  yield {end: true, truncated: finish === 'length', refused: finish === 'content_filter', stop: finish};
}

/* ---------- Google Gemini ---------- */
async function openGemini(images, prompt, signal, search, light) {
  const opts = {apiKey: process.env.GEMINI_API_KEY};
  if (process.env.GEMINI_BASE_URL) opts.httpOptions = {baseUrl: process.env.GEMINI_BASE_URL};
  const ai = new GoogleGenAI(opts);
  const parts = [...images.map(im => ({inlineData: {mimeType: im.type, data: im.data}})), {text: prompt}];
  const level = (process.env.GEMINI_THINKING || 'XHIGH').trim().toUpperCase();
  let last;
  const skipped = [];
  // 按次序試每個模型：任何 API 錯誤（型號不存在、無權限、額度用完、參數不接受等）都記下原因，改試下一個；
  // 不接受指定思考深度（400）就先用該模型預設再試一次。
  const all = list(process.env.GEMINI_MODEL, GEMINI_DEFAULT), lite = all.filter(m => !/-pro\b/i.test(m));
  for (const model of light && lite.length ? lite : all) {
    const config = {maxOutputTokens: 32000, abortSignal: signal};
    if (level !== 'OFF') config.thinkingConfig = {thinkingLevel: level};
    if (search) config.tools = [{googleSearch: {}}];
    for (;;) {
      try {
        const res = await ai.models.generateContentStream({model, contents: [{role: 'user', parts}], config});
        return {name: 'gemini', model, events: geminiEvents(res), skipped};
      } catch (e) {
        last = e;
        if (!(e instanceof ApiError)) throw e;
        if (e.status === 400 && config.thinkingConfig && /think/i.test(e.message || '')) { delete config.thinkingConfig; continue; }
        skipped.push(detailOf(e, model));
        break;
      }
    }
  }
  if (last) last.skipped = skipped;
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
