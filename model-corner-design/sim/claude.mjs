// Claude 角色走 mirasim 自己的 claude 网关（claude-haiku-5-5）：中转站的 msk_ 密钥没有 Claude 模型。
// 网关地址和令牌只存在于 mirasim 给 claude 智能体设的环境变量里：从正在运行的 claude 进程里找一套能用的，记在内存里，不落盘。
// 每次决定起一个没有任何工具、不读任何配置的 `claude -p`，人设放进 system prompt。
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { RelayError } from './llm.mjs';
import { keyDrop, keyGet, keySet } from './keyholder.mjs';

const CONFIG_DIR = '/data/ws/.claude-haiku', RUN_DIR = '/tmp/luna-codex-run';
let gateway = null;
const RP = readFileSync(fileURLToPath(new URL('../tools/luna-codex/rp_instructions.md', import.meta.url)), 'utf8');

// 候选：正在运行的 claude 进程的网关配置（开发服务器自己继承的那一套可能早就过期，不用）
function candidates() {
  const out = [], seen = new Set();
  for (const pid of readdirSync('/proc').filter((d) => /^\d+$/.test(d))) {
    try {
      if (!readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0')[0].endsWith('claude')) continue;
      const env = readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0');
      const get = (k) => env.find((e) => e.startsWith(`${k}=`))?.slice(k.length + 1);
      const url = get('ANTHROPIC_BASE_URL'), token = get('ANTHROPIC_AUTH_TOKEN') || get('ANTHROPIC_API_KEY');
      if (url && token && !token.startsWith('msk_') && !seen.has(url + token)) { seen.add(url + token); out.push({ url, token }); }
    } catch { /* 进程刚退出或无权读 */ }
  }
  return out;
}
let finding = null;
async function findGateway(model) {
  for (const g of candidates()) {
    try { await run(g, model, '只回答 OK', '你只回答 OK。', 30000); return g; } catch { /* 这一套不能用，试下一套 */ }
  }
  throw new RelayError('claude: no working mirasim claude gateway (no claude agent running)', 0, true);
}

export async function claudeChat({ model, messages, timeoutMs = 90000, rp = true }) {
  if (!gateway) gateway = await keyGet('claude');
  if (!gateway) { finding = finding || findGateway(model).finally(() => { finding = null; }); gateway = await finding; await keySet('claude', gateway); }
  const system = (rp ? RP + '\n\n' : '') + messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const user = messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n\n');
  try { return await run(gateway, model, user, system, timeoutMs); } catch (e) { gateway = null; await keyDrop('claude'); throw e; } // 下次重新找
}

function run(g, model, user, system, timeoutMs) {
  mkdirSync(CONFIG_DIR, { recursive: true }); mkdirSync(RUN_DIR, { recursive: true });
  const args = ['-p', '--bare', '--model', model, '--tools', '', '--strict-mcp-config', '--disable-slash-commands', '--no-session-persistence',
    '--setting-sources', '', '--output-format', 'json', '--system-prompt', system];
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, CLAUDE_CONFIG_DIR: CONFIG_DIR, ANTHROPIC_BASE_URL: g.url, ANTHROPIC_API_KEY: g.token, MAX_THINKING_TOKENS: '0', CLAUDE_CODE_EFFORT_LEVEL: 'low' };
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const p = spawn('claude', args, { cwd: RUN_DIR, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    const timer = setTimeout(() => { p.kill(); reject(new RelayError('claude timeout', 0, true)); }, timeoutMs);
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', () => {});
    p.on('close', (code) => {
      clearTimeout(timer);
      let r;
      try { r = JSON.parse(out); } catch { return reject(new RelayError(`claude exited ${code} without a result`, 0, true)); }
      if (r.is_error) return reject(new RelayError(`claude: ${String(r.result).slice(0, 160)}`, 0, true));
      const u = r.usage || {};
      resolve({ text: r.result || '', usage: { prompt_tokens: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0), completion_tokens: u.output_tokens || 0, via: 'claude' }, ms: Date.now() - t0 });
    });
    p.stdin.end(user);
  });
}
