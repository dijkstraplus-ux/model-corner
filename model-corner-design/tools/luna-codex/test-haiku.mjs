import { readFileSync } from 'node:fs';
import { HaikuSession } from './haiku-session.mjs';
const calls = readFileSync('/data/ws/model-corner-design/sim/data/calls.jsonl', 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  .filter((e) => e.char === 'claude' && e.kind === 'decide' && e.reply).slice(-3);
const base = readFileSync(new URL('./rp_instructions.md', import.meta.url).pathname, 'utf8') + '\n\n' + calls[0].messages[0].content;
const s = new HaikuSession();
const t0 = Date.now(); s.start(base); console.log(`spawned pid ${s.proc.pid}`);
for (const c of calls) {
  const r = await s.ask(c.messages.at(-1).content);
  const u = r.usage || {};
  console.log(`\n[${c.messages.at(-1).content.slice(0, 22).replace(/\n/g, ' ')}] ${r.isError ? 'ERROR' : 'ok'} ${r.ms} ms (api ${r.apiMs}) tools=${JSON.stringify(r.tools)} in=${u.input_tokens} cacheW=${u.cache_creation_input_tokens} cacheR=${u.cache_read_input_tokens} out=${u.output_tokens}`);
  console.log('haiku:', r.text);
  console.log('ds   :', c.reply);
}
console.log(`\ntotal ${Date.now() - t0} ms, same pid ${s.proc.pid}`);
s.close();
