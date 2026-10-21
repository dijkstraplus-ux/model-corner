// GPT 角色走 mirasim 自己的 codex 通道（gpt-6-luna）：中转站的 msk_ 密钥调不了 GPT 模型。
// 常驻一个精简过的 codex app-server（没有任何工具），每次决定开一条临时线程，人设放进 baseInstructions。
import { readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { fileURLToPath } from 'node:url';
import { LunaSession, mirasimProvider } from '../tools/luna-codex/luna-session.mjs';
import { RelayError } from './llm.mjs';
import { keyGet, keySet } from './keyholder.mjs';

const RP = readFileSync(fileURLToPath(new URL('../tools/luna-codex/rp_instructions.md', import.meta.url)), 'utf8');
const sessions = new Map();
// 通道地址和 key：地址是 mirasim 主机上的本机转发端口，会换；mirasim 的 codex 进程空闲会退出，所以读到的那份交给钥匙管家记着（只在内存里）
let provider = null;

// 地址的端口还有没有人在听（mirasim 换了转发端口后，旧地址的请求只会一直重试到超时）
const reachable = (url) => new Promise((ok) => {
  const u = new URL(url), s = connect(+u.port || 80, u.hostname), t = setTimeout(() => { s.destroy(); ok(false); }, 1500);
  s.on('connect', () => { clearTimeout(t); s.destroy(); ok(true); });
  s.on('error', () => { clearTimeout(t); ok(false); });
});

async function session(model) {
  let s = sessions.get(model);
  if (s) return s;
  s = (async () => {
    const x = new LunaSession({ model, effort: 'low' });
    // 以 mirasim 正在跑的 codex 进程为准（总是最新的地址和 key），换了就告诉钥匙管家；没有这样的进程才用钥匙管家记下的那份
    try { const p = mirasimProvider(); if (p.url !== provider?.url || p.key !== provider?.key) { provider = p; await keySet('codex', p); } }
    catch { if (!provider) provider = await keyGet('codex'); }
    if (!provider) throw new Error('no mirasim codex app-server running');
    if (!(await reachable(provider.url))) throw new Error(`channel ${new URL(provider.url).host} is gone and no mirasim codex app-server is running`);
    await x.start(provider);
    x.proc.on('exit', () => { if (sessions.get(model) === s) sessions.delete(model); });
    return x;
  })();
  sessions.set(model, s);
  try { return await s; } catch (e) { sessions.delete(model); throw e; }
}
// 超时或这一轮失败：关掉这个 app-server，下一次重新读地址再起一个
function drop(model) { const s = sessions.get(model); sessions.delete(model); s?.then((x) => x.close(), () => {}); }

export async function codexChat({ model, messages, timeoutMs = 90000, rp = true }) {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const user = messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n\n');
  let s;
  try { s = await session(model); } catch (e) { throw new RelayError(`codex: ${e.message}`, 0, true); }
  const t0 = Date.now();
  let r, timer;
  const late = new Promise((_, no) => { timer = setTimeout(() => no(new RelayError('codex timeout', 0, true)), timeoutMs); });
  try { r = await Promise.race([s.thread(rp ? `${RP}\n\n${system}` : system).then((th) => s.ask(th, user)), late]); }
  catch (e) { drop(model); throw e; }
  finally { clearTimeout(timer); }
  if (r.status && r.status !== 'completed') { drop(model); throw new RelayError(`codex turn ${r.status}: ${JSON.stringify(r.error || '').slice(0, 160)}`, 0, true); }
  const u = r.usage || {};
  return { text: r.text || '', usage: { prompt_tokens: u.inputTokens ?? u.input_tokens ?? 0, completion_tokens: u.outputTokens ?? u.output_tokens ?? 0, via: 'codex' }, ms: Date.now() - t0 };
}

export function closeCodex() { for (const s of sessions.values()) s.then((x) => x.close(), () => {}); sessions.clear(); }
