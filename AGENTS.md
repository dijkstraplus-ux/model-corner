# This space: model-corner town demo

The space's main page (port 5173, `npm run dev`) is the model-corner town demo, a seaside town called 鲸巷 (Whale Lane; formerly 模型街角).

- Vite serves **only** `model-corner-design/demo2/` (`index.html` + `assets/`, see `vite.config.ts`). The rest of
  the workspace holds the relay token - never widen `root` or
  `server.fs.allow`, and put nothing private into `demo2/`: everything in it is public.
- Published for everyone at https://mirasim.ai/@whale-lane/town (publish item `town`, kind service: `sim/server.mjs` on 5174
  serves `demo2/` + `/api`; config in `.mirasim/publish.json`). It proxies the running server, so every edit to `demo2/` or
  `sim/` is public at once, with no review. The orange 「加入鲸巷 · Join」 button (always labelled; on phones it floats at the bottom of the screen) opens a short dialog whose Join button goes to the space's join page https://mirasim.ai/j/z5qybknxe3x2 (Viewer: in at once; Collaborator: an admin approves, then their agent can edit). Visitor-facing text says 加入 / Join, not 「协作」: visitors don't understand it.
- Edit `demo2/index.html` directly; saving reloads the page. Page layout: one header bar (logo + 鲸巷, area tabs,
  time/weather, viewers, letter/collab buttons), the map on the left with small signs on it (where, what's on, light
  preview), and a side column with 「她们现在」 plus four tabs (动态 / 街区 / 画册 / 日报). The display font
  `assets/kuaile.woff2` is the complete ZCOOL KuaiLe (all 7,053 glyphs) — never subset it again: titles written by
  the models can use any character, and missing glyphs silently fall back to another font. The single-file copy for sharing is built with
  `cd model-corner-design && python3 -I tools/build_demo.py demo2/index.html dist/model-corner-town-v2.html`.
- After any change to `vite.config.ts`, check that `/mira_token` and `/@fs/data/ws/mira_token` give 404/403
  (status codes only, never print the body).
- The characters' life runs in `model-corner-design/sim/`: a Node child process started by the Vite plugin
  (`sim/vite-plugin.mjs`), listening on 127.0.0.1:5174 and reached only through the `/api` proxy. Each character
  decides her next activity with her namesake model: DeepSeek via the relay (`deepseek-v4.1-flash-1017`), Claude via
  mirasim's claude gateway (`claude:claude-haiku-5-5`, sim/claude.mjs), GPT via mirasim's codex provider
  (`codex:gpt-6-luna`, sim/codex.mjs). That provider is a loopback forwarding address on the mirasim host whose port
  changes; the sim reads it from a running mirasim codex process when there is one (never from its own app-server), else
  uses the keyholder's copy, and restarts its app-server after a timeout. If the log says `channel 127.0.0.1:… is gone`,
  any Codex turn in mirasim brings a fresh address and GPT picks it up on her next call. Gateway credentials are read from running agent processes and kept in memory only — never write them
  to disk. Models, call caps and an on/off switch are in `sim/config.json`. Hourly comics: sim/comic.mjs
  (`node sim/comic-now.mjs [minutes]` makes one by hand). Daily paper: sim/paper.mjs (written once a game day is over);
  chronicle: `chronicle()` in sim.mjs, served at /api/chronicle. Codex/claude gateway credentials are held by
  sim/keyholder.mjs (a detached process, memory only, socket /tmp/model-corner-keys.sock) so sim reloads keep them.
- The world itself is data: objects, items, kinds of gatherings, weather and neighbour requests live in
  `sim/content/*.json`; `sim/rules.mjs` + `sim/worldstate.mjs` run objects, timers and weather, `sim/social.mjs` runs
  items and lending, asking for help, invitations and gatherings, and bonds (shared moments, running jokes, favours
  owed, promises), `sim/events.mjs` runs the weekly calendar (calendar.json: market day, meteor night, lantern
  festival) and up to two small mishaps a day (incidents.json), `sim/projects.mjs` runs multi-day projects
  (projects.json: Claude's new story, DeepSeek's new dish, GPT's star chart). Each decision the model picks from a
  numbered option list built by `sim/menu.mjs`. Which animation row an action plays (stir, shape rice balls, sit on a
  bench, swing, sleep on a futon…) is data too: `sim/content/poses.json`; the page falls back to the old row when a
  character has no such row yet. To add an object, an item, a kind of gathering, an event or a mishap, add data there
  (`ideas` in gatherings.json say who thinks of inviting whom, and when). Design notes:
  `model-corner-design/docs/world-depth.md`. Tests can start the world on another day: `SIM_DAY=6 SIM_START=17:00`.
- Character art: each girl has walk8, act8 and three more action atlases (`<id>-act8b/c/d`, plus `-hd` copies for
  close-ups); metadata in `demo2/assets/atlas.json`. After adding or changing an atlas there, run
  `python3 -I tools/sync_atlas.py` to copy it into the page. Map props (sandcastle stages, parcels, umbrella, swing
  seat, lantern garland…) are `demo2/assets/props.webp` + the inline `PROPS` table; where seated poses sit, where
  futons go and how the swing hangs are `SEATS`, the `seat`/`bed` room spots and `SWING` in `demo2/index.html`.
- Languages: zh / en / ja. Chinese stays the world's internal language (prompts, state, sim logic); only output is translated.
  Every model call that writes visible text returns `en` and `ja` blocks next to the zh fields, and `learn()` in `sim/i18n.mjs`
  stores them. Everything else (strings the code puts together, old data) is translated in batches by the translator in
  `sim/i18n.mjs` (config `i18n` in `sim/config.json`, claude gateway by default, only when someone views en/ja) and cached in
  `sim/data/i18n.json`. Names of places, things, items and events: `sim/content/glossary.json` (when you add content, add its
  en/ja names there too). `/api/state` and `/api/chronicle` take `?lang=en|ja`; values under `state` keys stay zh and come
  translated in the top-level `tr` map. The page's own text: the `I18N` table (`'zh': ['en', 'ja']`) above the main script in
  `demo2/index.html`, used as `t('第 {d} 天', { d })`; fixed HTML uses `data-i18n`; `I18N_MISS` in the console lists missing keys.
  Page logic must not match on server text (use ids, `kind`, `comic`, `state` fields).
- Visitors never influence the world (no gifts, wishes, votes). The only thing they can send is a letter to the dev
  team (POST /api/letters, sim/audience.mjs, stored in sim/data/audience/; only server.mjs imports it — never feed it
  into prompts). Read and answer letters with `node sim/letters-cli.mjs list` / `reply <id> <text>`. State is `sim/data/state.json` (delete it to restart the world at day 1
  07:00); every model call is logged to `sim/data/calls.jsonl`. Edits in `sim/*.mjs` reload it by themselves.
- On relay 429 `credit_exhausted` the sim stops calling the model (characters fall back to habits) until it is
  restarted. Do not route around it.
- Where characters can walk: `nav/<area>.json`, built by `tools/walkmask.py` (local SegFormer first guess, then
  reviewed corrections in `nav/<area>-fixes.json`). After rebuilding a grid, `touch sim/world.mjs` to reload.
- Git: https://github.com/dijkstraplus-ux/model-corner (public; the human-facing intro is `README.md`). `.gitignore`
  keeps out `mira_token`, the agent homes of the Claude/GPT channels (`.claude-haiku/`, `.codex-luna/`), the running
  world (`sim/data/`: state, call log, comics, letters), raw generated art (`gen/` keeps only the `p-*.txt` prompts),
  `ref/`, `promo/x-launch/`, `backups/`, `dist/` and `archive/`. Commit or push only when the user asks: everything
  pushed is public.
- `archive/` (not in git) holds retired work, listed in `archive/README.md`: the space's starter template Pixel Town
  (switched off; its files and agent notes are in `archive/pixel-town/`), the v1 demo, early atlases, chibi sprites
  of other model girls, icon drafts. Nothing in the page or the sim uses it.
