// 通过 mirasim 中转站调用模型。token 只在这里读，从不写进日志或接口返回
import { readFileSync } from 'node:fs';

const RELAY = 'https://relay.mirasim.ai/v1/chat/completions';
const TOKEN_FILE = process.env.MIRA_TOKEN_FILE || '/data/ws/mira_token';

export class CreditExhausted extends Error {}
export class RelayError extends Error {
  constructor(msg, status, retryable) { super(msg); this.status = status; this.retryable = retryable; }
}

function token() {
  const m = readFileSync(TOKEN_FILE, 'utf8').match(/msk_[A-Za-z0-9_.-]+/);
  if (!m) throw new RelayError('no relay token', 0, false);
  return m[0];
}

// 返回 { text, usage, ms }。额度用完抛 CreditExhausted（调用方要停掉所有调用，不要重试）
export async function chat({ model, messages, maxTokens = 800, temperature = 0.9, reasoning, json = true, timeoutMs = 45000 }) {
  const body = { model, messages, max_tokens: maxTokens, temperature };
  if (json) body.response_format = { type: 'json_object' };
  if (reasoning) body.reasoning = reasoning;
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), timeoutMs), t0 = Date.now();
  let res, text;
  try {
    res = await fetch(RELAY, { method: 'POST', signal: ctl.signal, headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    text = await res.text();
  } catch (e) {
    throw new RelayError(e.name === 'AbortError' ? 'timeout' : `network: ${e.message}`, 0, true);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    if (res.status === 429 && text.includes('credit_exhausted')) throw new CreditExhausted(text.slice(0, 200));
    throw new RelayError(`HTTP ${res.status}: ${text.slice(0, 200)}`, res.status, res.status === 429 || res.status >= 500);
  }
  const data = JSON.parse(text);
  const msg = data.choices?.[0]?.message?.content ?? '';
  return { text: msg, usage: data.usage || {}, ms: Date.now() - t0, finish: data.choices?.[0]?.finish_reason };
}

// 模型偶尔会在 JSON 外面包一层文字或代码块
export function parseJson(text) {
  const s = text.indexOf('{'), e = text.lastIndexOf('}');
  if (s < 0 || e < s) throw new Error('no JSON object in reply');
  return JSON.parse(text.slice(s, e + 1));
}

// 生图：gpt-image-2，返回 PNG 的 Buffer 和用量
export async function image({ prompt, size = '1024x1536', quality = 'high', timeoutMs = 300000 }) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), timeoutMs), t0 = Date.now();
  let res, text;
  try {
    res = await fetch(RELAY.replace('chat/completions', 'images/generations'), { method: 'POST', signal: ctl.signal, headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'gpt-image-2', prompt, size, quality, n: 1 }) });
    text = await res.text();
  } catch (e) {
    throw new RelayError(e.name === 'AbortError' ? 'timeout' : `network: ${e.message}`, 0, true);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    if (res.status === 429 && text.includes('credit_exhausted')) throw new CreditExhausted(text.slice(0, 200));
    throw new RelayError(`HTTP ${res.status}: ${text.slice(0, 200)}`, res.status, res.status === 429 || res.status >= 500);
  }
  const data = JSON.parse(text);
  return { png: Buffer.from(data.data[0].b64_json, 'base64'), usage: data.usage || {}, ms: Date.now() - t0 };
}
