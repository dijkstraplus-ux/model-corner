import { readFileSync } from 'node:fs';
import { LunaSession } from './luna-session.mjs';
const calls = readFileSync('/data/ws/model-corner-design/sim/data/calls.jsonl', 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  .filter((e) => e.char === 'gpt' && e.kind === 'decide' && e.reply).slice(-3);
const base = readFileSync(new URL('./rp_instructions.md', import.meta.url).pathname, 'utf8') + '\n\n' + calls[0].messages[0].content;
const s = new LunaSession();
let t0 = Date.now(); await s.start(); const tid = await s.thread(base);
console.log(`app-server + thread ready in ${Date.now() - t0} ms, pid ${s.proc.pid}, thread ${tid}`);
for (const c of calls) {
  const r = await s.ask(tid, c.messages.at(-1).content);
  console.log(`\n[${c.messages.at(-1).content.slice(0, 22).replace(/\n/g, ' ')}] ${r.status} ${r.ms} ms tools=${JSON.stringify(r.items)} usage=${JSON.stringify(r.usage)}`);
  console.log('luna:', r.text, r.error ? JSON.stringify(r.error) : '');
  console.log('ds  :', c.reply);
}
s.close();
