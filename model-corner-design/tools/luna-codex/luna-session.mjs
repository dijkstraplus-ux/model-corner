// 常驻的 codex app-server 客户端：一个进程、每个角色一条线程，走 mirasim 自己的 codex provider。
// provider 的地址和 key 从 mirasim 正在跑的 codex app-server 进程里读，只放进子进程的参数/环境，不打印也不落盘。
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const CATALOG = new URL('./luna_catalog.json', import.meta.url).pathname;
const CODEX_HOME = '/data/ws/.codex-luna';
const RUN_DIR = '/tmp/luna-codex-run'; // 空目录，codex 的 cwd

export function mirasimProvider() {
  // 跳过我们自己拉起的 app-server（CODEX_HOME 是 .codex-luna）：它带的是当初读到的地址，mirasim 换了转发端口后就是死的；有几个时用最新的
  const pids = execFileSync('pgrep', ['-x', 'codex'], { encoding: 'utf8' }).trim().split('\n').reverse();
  for (const pid of pids) {
    try {
      const args = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0');
      const env = readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0');
      if (env.includes(`CODEX_HOME=${CODEX_HOME}`)) continue;
      const url = args.find((a) => a.startsWith('model_providers.mirasim.base_url='))?.split('=').slice(1).join('=');
      const key = env.find((e) => e.startsWith('OPENAI_API_KEY='))?.slice(15);
      if (url && key) return { url, key };
    } catch { /* 进程刚好退出 */ }
  }
  throw new Error('no mirasim codex app-server running');
}

// 去掉 codex 的编程助手外壳：模型目录换成精简版（无 code mode / multi-agent / shell），各类说明块和工具全关
const LEAN = [
  `model_catalog_json="${CATALOG}"`, 'project_doc_max_bytes=0', 'web_search="disabled"',
  'include_permissions_instructions=false', 'include_environment_context=false', 'include_apps_instructions=false',
  'include_collaboration_mode_instructions=false', 'skills.include_instructions=false',
  'tools.experimental_request_user_input.enabled=false', 'model_auto_compact_token_limit=60000',
];
const OFF = ['apps', 'browser_use', 'browser_use_external', 'computer_use', 'goals', 'image_generation', 'multi_agent', 'plugins',
  'shell_tool', 'skill_search', 'sleep_tool', 'tool_suggest', 'unified_exec', 'view_image', 'hooks', 'code_mode_host', 'memories'];

export class LunaSession {
  constructor({ model = 'gpt-6-luna', effort = 'low' } = {}) { this.model = model; this.effort = effort; this.next = 1; this.wait = new Map(); this.turns = new Map(); }

  async start(provider) {
    const p = provider || mirasimProvider();
    mkdirSync(RUN_DIR, { recursive: true }); mkdirSync(CODEX_HOME, { recursive: true });
    const args = ['app-server', '-c', 'model_provider=mirasim', '-c', 'model_providers.mirasim.name=mirasim',
      '-c', `model_providers.mirasim.base_url=${p.url}`, '-c', 'model_providers.mirasim.wire_api=responses',
      '-c', 'model_providers.mirasim.env_key=OPENAI_API_KEY', '-c', 'model_providers.mirasim.http_headers.x-openai-actor-authorization=mirasim',
      ...LEAN.flatMap((c) => ['-c', c]), ...OFF.flatMap((f) => ['--disable', f])];
    this.proc = spawn('codex', args, { cwd: RUN_DIR, env: { ...process.env, OPENAI_API_KEY: p.key, CODEX_HOME }, stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc.stderr.on('data', () => {});
    this.proc.on('exit', (code) => { for (const w of this.wait.values()) w.reject(new Error(`app-server exited ${code}`)); });
    createInterface({ input: this.proc.stdout }).on('line', (l) => this.onLine(l));
    await this.rpc('initialize', { clientInfo: { name: 'model-corner-sim', version: '0.1' } });
    this.send({ method: 'initialized' });
  }

  send(msg) { this.proc.stdin.write(JSON.stringify(msg) + '\n'); }
  rpc(method, params) {
    const id = this.next++;
    return new Promise((resolve, reject) => { this.wait.set(id, { resolve, reject }); this.send({ id, method, params }); });
  }
  onLine(line) {
    let m; try { m = JSON.parse(line); } catch { return; }
    if (m.id !== undefined && !m.method) {
      const w = this.wait.get(m.id); this.wait.delete(m.id);
      return m.error ? w?.reject(new Error(JSON.stringify(m.error))) : w?.resolve(m.result);
    }
    if (m.id !== undefined && m.method) return this.send({ id: m.id, error: { code: -32601, message: 'no approvals here' } }); // 不该有工具，有也一律拒
    const t = this.turns.get(m.params?.threadId);
    if (!t) return;
    if (m.method === 'item/completed' && m.params.item?.type === 'agentMessage') t.text = m.params.item.text;
    else if (m.method === 'thread/tokenUsage/updated') t.usage = m.params.tokenUsage?.last ?? m.params.tokenUsage;
    else if (m.method === 'item/started' && m.params.item?.type !== 'agentMessage' && m.params.item?.type !== 'userMessage' && m.params.item?.type !== 'reasoning') t.items.push(m.params.item?.type);
    else if (m.method === 'turn/completed') { this.turns.delete(m.params.threadId); t.done({ text: t.text, usage: t.usage, items: t.items, status: m.params.turn?.status, error: m.params.turn?.error, ms: Date.now() - t.t0 }); }
  }

  async thread(baseInstructions) {
    const r = await this.rpc('thread/start', { model: this.model, baseInstructions, ephemeral: true, approvalPolicy: 'never', sandbox: 'read-only', cwd: RUN_DIR });
    return r.thread.id;
  }
  ask(threadId, text, outputSchema) {
    return new Promise((done, reject) => {
      this.turns.set(threadId, { done, text: '', items: [], t0: Date.now() });
      this.rpc('turn/start', { threadId, input: [{ type: 'text', text }], effort: this.effort, ...(outputSchema ? { outputSchema } : {}) }).catch(reject);
    });
  }
  close() { this.proc?.kill(); }
}
