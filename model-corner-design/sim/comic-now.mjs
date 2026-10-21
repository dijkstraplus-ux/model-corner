// 手动生成一张漫画：node comic-now.mjs [分钟数，默认 60]——用最近这段时间的世界日志
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeComic } from './comic.mjs';

const DATA = process.env.SIM_DATA || fileURLToPath(new URL('./data/', import.meta.url));
const cfg = JSON.parse(readFileSync(fileURLToPath(new URL('./config.json', import.meta.url)), 'utf8'));
const state = JSON.parse(readFileSync(`${DATA}state.json`, 'utf8'));
const minutes = +(process.argv[2] || 60), to = Date.now();
const c = await makeComic(state, to - minutes * 60000, to, cfg);
console.log(c ? JSON.stringify({ kind: c.kind, title: c.title, reason: c.reason, file: c.file }) : 'nothing happened in that window');
