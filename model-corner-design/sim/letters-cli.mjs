// 开发团队看留言、回复：node letters-cli.mjs list | reply <留言id> <回复内容>
import { listLetters, replyLetter } from './audience.mjs';

const [cmd, id, ...rest] = process.argv.slice(2);
if (cmd === 'reply' && id && rest.length) {
  replyLetter(id, rest.join(' '));
  console.log(`replied to ${id}`);
} else {
  for (const l of listLetters()) {
    console.log(`${l.id}  ${new Date(l.at).toLocaleString('zh-CN')}  [${l.kind}] ${l.via}${l.visitor ? ' ' + l.visitor : ''}`);
    console.log(`  ${l.text}`);
    if (l.reply) console.log(`  ↳ 回复：${l.reply.text}`);
  }
}
