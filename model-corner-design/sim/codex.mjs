// GPT 角色走 mirasim 自己的 codex 通道（gpt-6-luna）：中转站的 msk_ 密钥调不了 GPT 模型。
// 常驻一个精简过的 codex app-server（没有任何工具），每次决定开一条临时线程，人设放进 baseInstructions。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LunaSession, mirasimProvider } from '../tools/luna-codex/luna-session.mjs';
import { RelayError } from './llm.mjs';
import { keyGet, keySet } from './keyholder.mjs';

const RP = readFileSync(fileURLToPath(new URL('../tools/luna-codex/rp_instructions.md', import.meta.url)), 'utf8');
const sessions = new Map();
// 通道地址和 key：mirasim 的 codex 进程空闲会退出，所以读到一次就记在内存里（不落盘），之后重启自己的 app-server 时复用
let provider = null;

async function session(model) {
  let s = sessions.get(model);
  if (s) return s;
  s = (async () => {
    const x = new LunaSession({ model, effort: 'low' });
    // 先问钥匙管家；没有就从正在运行的 mirasim codex 进程里读一次，交给它记住
    if (!provider) provider = await keyGet('codex');
    if (!provider) { provider = mirasimProvider(); await keySet('codex', provider); }
    try { await x.start(provider); } catch (e) {
      // 令牌可能换了：正好有 mirasim 的 codex 进程就重新读一次；没有就留着旧的，下次再试（丢掉的话只能等下一个 codex 进程）
      try { const p = mirasimProvider(); if (p.url !== provider.url || p.key !== provider.key) { provider = p; await keySet('codex', p); } } catch { /* 没有 codex 进程 */ }
      throw e;
    }
    x.proc.on('exit', () => sessions.delete(model));
    return x;
  })();
  sessions.set(model, s);
  try { return await s; } catch (e) { sessions.delete(model); throw e; }
}

export async function codexChat({ model, messages, timeoutMs = 90000 }) {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const user = messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n\n');
  let s;
  try { s = await session(model); } catch (e) { throw new RelayError(`codex: ${e.message}`, 0, true); }
  const t0 = Date.now();
  const thread = await s.thread(`${RP}\n\n${system}`);
  const r = await Promise.race([s.ask(thread, user), new Promise((_, no) => setTimeout(() => no(new RelayError('codex timeout', 0, true)), timeoutMs))]);
  if (r.status && r.status !== 'completed') throw new RelayError(`codex turn ${r.status}: ${JSON.stringify(r.error || '').slice(0, 160)}`, 0, true);
  const u = r.usage || {};
  return { text: r.text || '', usage: { prompt_tokens: u.inputTokens ?? u.input_tokens ?? 0, completion_tokens: u.outputTokens ?? u.output_tokens ?? 0, via: 'codex' }, ms: Date.now() - t0 };
}

export function closeCodex() { for (const s of sessions.values()) s.then((x) => x.close(), () => {}); sessions.clear(); }
