// Vercel 函數：把頁面的提問和書頁相片轉交 Claude，逐段串流答覆。
// 需要在 Vercel 設定環境變數：ANTHROPIC_API_KEY（API 金鑰）、APP_PASSCODE（通行碼，防止別人用你的額度）。
// 回應格式：每行一個 JSON —— {"t": "文字"}，最後 {"done": true, "truncated": bool, "stop": "..."}，出錯時 {"error": "代碼"}。
import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-opus-5-5';
const MAX_IMAGES = 4;
const MAX_PROMPT = 60000;
const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'}
});
const configured = () => !!(process.env.ANTHROPIC_API_KEY && process.env.APP_PASSCODE);

export function GET() {
  return json(200, {app: '睇書記錄', configured: configured(), maxImages: MAX_IMAGES});
}

export async function POST(request) {
  if (!configured()) return json(503, {error: 'not_configured'});
  let body;
  try { body = await request.json(); } catch (e) { return json(400, {error: 'bad_request'}); }
  if (!body || body.pass !== process.env.APP_PASSCODE) return json(401, {error: 'bad_pass'});
  const prompt = typeof body.prompt === 'string' ? body.prompt : '';
  if (!prompt) return json(400, {error: 'bad_request'});
  if (prompt.length > MAX_PROMPT) return json(413, {error: 'prompt_too_large'});
  const images = Array.isArray(body.images) ? body.images : [];
  if (images.length > MAX_IMAGES) return json(413, {error: 'too_many_images'});
  const content = [];
  for (const im of images) {
    if (!im || !TYPES.has(im.type) || typeof im.data !== 'string' || !im.data) return json(400, {error: 'image_rejected'});
    content.push({type: 'image', source: {type: 'base64', media_type: im.type, data: im.data}});
  }
  content.push({type: 'text', text: prompt});

  const client = new Anthropic();
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctl) {
      const send = o => ctl.enqueue(enc.encode(JSON.stringify(o) + '\n'));
      try {
        const s = client.beta.messages.stream({
          model: MODEL,
          max_tokens: 16000,
          output_config: {effort: 'medium'},
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          messages: [{role: 'user', content}]
        }, {signal: request.signal});
        for await (const ev of s) {
          if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') send({t: ev.delta.text});
        }
        const msg = await s.finalMessage();
        if (msg.stop_reason === 'refusal') send({error: 'refused'});
        else send({done: true, truncated: msg.stop_reason === 'max_tokens', stop: msg.stop_reason});
      } catch (e) {
        send({error: errorCode(e)});
      }
      ctl.close();
    }
  });
  return new Response(stream, {headers: {'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store'}});
}

function errorCode(e) {
  if (e instanceof Anthropic.APIUserAbortError) return 'cancelled';
  if (e instanceof Anthropic.AuthenticationError) return 'server_key';
  if (e instanceof Anthropic.PermissionDeniedError) return 'server_key';
  if (e instanceof Anthropic.RateLimitError) return 'rate_limited';
  if (e instanceof Anthropic.BadRequestError) return /image/i.test(e.message || '') ? 'image_rejected' : 'bad_request';
  if (e instanceof Anthropic.APIConnectionError) return 'network';
  if (e instanceof Anthropic.APIError) return 'upstream';
  return 'upstream';
}
