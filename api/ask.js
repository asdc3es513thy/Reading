// Vercel 函數：把頁面的提問和書頁相片轉交 Google Gemini（免費額度），逐段串流答覆。
// 需要在 Vercel 設定環境變數：GEMINI_API_KEY（Google AI Studio 的 API 金鑰）、APP_PASSCODE（通行碼，防止別人用你的額度）。
// 可選：GEMINI_MODEL（逗號分隔，按次序試；預設先 gemini-3.8-pro，用不到就 gemini-3.8-flash）；
// GEMINI_THINKING（思考深度 LOW／MEDIUM／HIGH／XHIGH，預設 XHIGH；設為 OFF 則不指定）。
// 回應格式：每行一個 JSON —— {"t": "文字"}，最後 {"done": true, "truncated": bool, "stop": "..."}，出錯時 {"error": "代碼"}。
import {GoogleGenAI, ApiError} from '@google/genai';

const DEFAULT_MODELS = 'gemini-3.8-pro,gemini-3.8-flash';
const MAX_IMAGES = 4;
const MAX_PROMPT = 60000;
const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const BLOCKED = new Set(['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION', 'IMAGE_SAFETY', 'IMAGE_PROHIBITED_CONTENT']);

const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'}
});
const configured = () => !!(process.env.GEMINI_API_KEY && process.env.APP_PASSCODE);

export function GET() {
  return json(200, {app: '睇書記錄', configured: configured(), maxImages: MAX_IMAGES, provider: 'gemini'});
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
  const parts = [];
  for (const im of images) {
    if (!im || !TYPES.has(im.type) || typeof im.data !== 'string' || !im.data) return json(400, {error: 'image_rejected'});
    parts.push({inlineData: {mimeType: im.type, data: im.data}});
  }
  parts.push({text: prompt});

  const opts = {apiKey: process.env.GEMINI_API_KEY};
  if (process.env.GEMINI_BASE_URL) opts.httpOptions = {baseUrl: process.env.GEMINI_BASE_URL};
  const ai = new GoogleGenAI(opts);
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctl) {
      const send = o => ctl.enqueue(enc.encode(JSON.stringify(o) + '\n'));
      try {
        const res = await openStream(ai, parts, request.signal);
        let finish = '', blocked = '';
        for await (const chunk of res) {
          if (chunk.promptFeedback && chunk.promptFeedback.blockReason) blocked = chunk.promptFeedback.blockReason;
          const c = chunk.candidates && chunk.candidates[0];
          if (c && c.finishReason) finish = c.finishReason;
          const t = chunk.text;
          if (t) send({t});
        }
        if (blocked || BLOCKED.has(finish)) send({error: 'refused'});
        else send({done: true, truncated: finish === 'MAX_TOKENS', stop: finish});
      } catch (e) {
        send({error: errorCode(e)});
      }
      ctl.close();
    }
  });
  return new Response(stream, {headers: {'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store'}});
}

// 按次序試每個模型：型號不存在、無權限或額度用完（404／403／429）就試下一個；
// 不接受指定思考深度（400）就用該模型預設再試一次。
async function openStream(ai, parts, signal) {
  const models = (process.env.GEMINI_MODEL || DEFAULT_MODELS).split(',').map(m => m.trim()).filter(Boolean);
  const level = (process.env.GEMINI_THINKING || 'XHIGH').trim().toUpperCase();
  let last;
  for (const model of models) {
    const config = {maxOutputTokens: 32000, abortSignal: signal};
    if (level !== 'OFF') config.thinkingConfig = {thinkingLevel: level};
    for (;;) {
      try { return await ai.models.generateContentStream({model, contents: [{role: 'user', parts}], config}); }
      catch (e) {
        last = e;
        if (!(e instanceof ApiError)) throw e;
        if (e.status === 400 && config.thinkingConfig && /think/i.test(e.message || '')) { delete config.thinkingConfig; continue; }
        if ([403, 404, 429].includes(e.status)) break;
        throw e;
      }
    }
  }
  throw last;
}

function errorCode(e) {
  if (e && e.name === 'AbortError') return 'cancelled';
  if (e instanceof ApiError) {
    if (e.status === 400 && /api key/i.test(e.message || '')) return 'server_key';
    if (e.status === 401 || e.status === 403) return 'server_key';
    if (e.status === 429) return 'rate_limited';
    if (e.status === 400) return /image|mime/i.test(e.message || '') ? 'image_rejected' : 'bad_request';
    return 'upstream';
  }
  return 'network';
}
