// 开发服务器启动时把模拟服务（server.mjs）作为子进程带起来，挂了就重启；改 sim/ 里的代码时 node --watch 会自动重载
import { spawn } from 'node:child_process';

export default function simPlugin({ dir, port }) {
  let child = null, stopped = false, timer = null;
  const run = () => {
    child = spawn(process.execPath, ['--watch', 'server.mjs'], { cwd: dir, env: { ...process.env, SIM_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (d) => process.stdout.write(String(d)));
    child.stderr.on('data', (d) => process.stderr.write(String(d)));
    child.on('exit', () => { child = null; if (!stopped) timer = setTimeout(run, 3000); });
  };
  return {
    name: 'model-corner-sim',
    apply: 'serve',
    configureServer(server) {
      run();
      server.httpServer?.once('close', () => { stopped = true; clearTimeout(timer); child?.kill('SIGTERM'); });
    },
  };
}
