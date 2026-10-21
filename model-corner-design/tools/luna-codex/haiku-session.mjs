// 常驻的 Claude Code 客户端：每个角色一个 `claude -p --input-format stream-json` 进程（一个进程就是一段会话），
// 走 mirasim 自己的 claude 网关。网关地址和 token 来自 mirasim 给 claude agent 设的 ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN，只传给子进程。
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createInterface } from 'node:readline';

const CONFIG_DIR = '/data/ws/.claude-haiku'; // 隔离的配置目录，不碰用户自己的 ~/.claude
const RUN_DIR = '/tmp/luna-codex-run';

export class HaikuSession {
  constructor({ model = 'claude-haiku-5-5', baseUrl = process.env.ANTHROPIC_BASE_URL, token = process.env.ANTHROPIC_AUTH_TOKEN } = {}) {
    if (!baseUrl || !token) throw new Error('no mirasim claude gateway in env');
    Object.assign(this, { model, baseUrl, token, queue: [] });
  }

  start(systemPrompt) {
    mkdirSync(CONFIG_DIR, { recursive: true }); mkdirSync(RUN_DIR, { recursive: true });
    // --bare + --tools "" + 空 setting-sources：没有工具、CLAUDE.md、hooks、MCP、skills；Haiku 5.5 关不掉 thinking，effort=low 把它压到 ~380 token
    const args = ['-p', '--bare', '--model', this.model, '--tools', '', '--strict-mcp-config', '--disable-slash-commands',
      '--no-session-persistence', '--setting-sources', '', '--input-format', 'stream-json', '--output-format', 'stream-json',
      '--verbose', '--system-prompt', systemPrompt];
    const env = { PATH: process.env.PATH, HOME: process.env.HOME, CLAUDE_CONFIG_DIR: CONFIG_DIR, ANTHROPIC_BASE_URL: this.baseUrl, ANTHROPIC_API_KEY: this.token, MAX_THINKING_TOKENS: '0', CLAUDE_CODE_EFFORT_LEVEL: 'low' };
    this.proc = spawn('claude', args, { cwd: RUN_DIR, env, stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc.stderr.on('data', () => {});
    this.proc.on('exit', (code) => { for (const q of this.queue.splice(0)) q.reject(new Error(`claude exited ${code}`)); });
    createInterface({ input: this.proc.stdout }).on('line', (l) => this.onLine(l));
  }

  onLine(line) {
    let m; try { m = JSON.parse(line); } catch { return; }
    const q = this.queue[0];
    if (!q) return;
    if (m.type === 'assistant') for (const c of m.message?.content || []) if (c.type === 'tool_use') q.tools.push(c.name);
    if (m.type === 'result') {
      this.queue.shift();
      q.resolve({ text: m.result, usage: m.usage, ms: Date.now() - q.t0, apiMs: m.duration_api_ms, isError: m.is_error, tools: q.tools });
    }
  }

  ask(text) {
    return new Promise((resolve, reject) => {
      this.queue.push({ resolve, reject, t0: Date.now(), tools: [] });
      this.proc.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: text } }) + '\n');
    });
  }
  close() { this.proc?.stdin.end(); }
}
