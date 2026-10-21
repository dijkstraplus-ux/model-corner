// 钥匙管家：替模拟服务记住 mirasim 的 codex / claude 通道（地址和令牌），只放在内存里，从不写盘。
// 模拟服务改代码重启时它不跟着退出，所以通道只要接上过一次就一直可用。只通过权限 600 的本机套接字说话。
import { chmodSync, existsSync, unlinkSync } from 'node:fs';
import { connect, createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const SOCK = '/tmp/model-corner-keys.sock';

if (process.argv[2] === 'serve') {
  const keys = {};
  if (existsSync(SOCK)) unlinkSync(SOCK);
  const server = createServer((s) => {
    let buf = '';
    s.on('data', (d) => {
      buf += d;
      if (!buf.includes('\n')) return;
      try {
        const m = JSON.parse(buf.slice(0, buf.indexOf('\n')));
        if (m.op === 'set' && typeof m.name === 'string') { keys[m.name] = m.value; s.end('{"ok":true}\n'); }
        else if (m.op === 'get') s.end(JSON.stringify({ value: keys[m.name] ?? null }) + '\n');
        else if (m.op === 'drop') { delete keys[m.name]; s.end('{"ok":true}\n'); }
        else s.end('{}\n');
      } catch { s.end('{}\n'); }
    });
  });
  server.listen(SOCK, () => chmodSync(SOCK, 0o600));
}

function talk(msg) {
  return new Promise((resolve) => {
    const s = connect(SOCK);
    let buf = '';
    s.on('data', (d) => { buf += d; });
    s.on('end', () => { try { resolve(JSON.parse(buf)); } catch { resolve(null); } });
    s.on('error', () => resolve(null));
    s.write(JSON.stringify(msg) + '\n');
  });
}

let starting = null;
async function ensure() {
  if (await talk({ op: 'ping' })) return;
  starting = starting || new Promise((r) => {
    const p = spawn(process.execPath, [fileURLToPath(import.meta.url), 'serve'], { detached: true, stdio: 'ignore', env: { PATH: process.env.PATH } });
    p.unref();
    setTimeout(r, 400);
  });
  await starting;
  starting = null;
}
export async function keyGet(name) { await ensure(); return (await talk({ op: 'get', name }))?.value ?? null; }
export async function keySet(name, value) { await ensure(); await talk({ op: 'set', name, value }); }
export async function keyDrop(name) { await ensure(); await talk({ op: 'drop', name }); }
