<p align="center"><img src="model-corner-design/promo/icon.webp" width="112" alt="Whale Lane"></p>

<h1 align="center">Whale Lane · 鲸巷</h1>

<p align="center">Three girls — DeepSeek, Claude and GPT — live on a little seaside street,<br>and every step each of them takes is decided by her namesake model.</p>

<p align="center"><a href="https://mirasim.ai/@whale-lane/town">Watch them live</a></p>

<p align="center"><a href="README.md">中文</a> · English · <a href="README.ja.md">日本語</a></p>

![Whale Lane](model-corner-design/promo/cover.jpg)

DeepSeek runs the Deep Sea Diner, shaping rice balls and trying out new dishes. Claude keeps Paper Leaf Books and works on her new short story.
GPT takes the neighbours' requests at Starglass Odd Jobs and draws star charts.
They lend each other things, ask each other for help, plan to watch the meteor shower together on Saturday night — and sometimes forget what they promised.
Every hour the town's "editor" turns what happened into a four-panel comic, and every day ends with a little newspaper.

Visitors can't steer them: no tips, wishes or votes. The only thing you can do is write a letter to the dev team.
If you'd like to help build the street, click 「Join Whale Lane」 at the top right of the page, or open https://mirasim.ai/j/z5qybknxe3x2 directly:
pick Viewer to just look around (one click), or Collaborator to have your agent change the street once an admin approves.

## How it works

- **Time**: game time runs 8× faster than real time, so a day takes about 3 hours. They keep living even when nobody is watching.
- **Brains**: when a character is ready for her next activity, the sim gives her model her current situation, her memories and a numbered list of options.
  The model picks one and writes her inner monologue and what she says out loud.
  DeepSeek uses `deepseek-v4.1-flash`, Claude uses `claude-haiku-5-5`, GPT uses `gpt-6-luna`.
- **Three languages**: the page comes in 中文, English and 日本語. Every model reply is written in all three languages at once;
  sentences the code puts together are translated by Claude Haiku and cached. The translated names of places and things are in
  `model-corner-design/sim/content/glossary.json`.
- **The world is data**: objects, items, gatherings, weather, festivals, small mishaps, multi-day projects, and which animation each action plays
  all live in `model-corner-design/sim/content/*.json`. Adding something to the town is usually just adding a piece of JSON.
- **Visuals**: the three areas (Whale Lane Square, Seaside Market, Hillside Park) and the three shops are each one large painting; the characters are
  frame-by-frame sprite atlases. The page is a single `index.html` with no build step.

## Running locally

Needs Node 20.19+ or 22.12+.

```sh
npm install
npm run dev          # open http://127.0.0.1:5173
```

`npm run dev` starts Vite (serving only the page directory) and brings up the sim server (127.0.0.1:5174; the page reaches it through the `/api` proxy).
You can also run just the sim server, which serves the page itself: `npm start`, then open http://127.0.0.1:5174 .

Model channels:

- DeepSeek's decisions, the comics and the daily paper go through the mirasim relay; the key lives in `mira_token` at the repo root
  (or point `MIRA_TOKEN_FILE` at another file). That file is in `.gitignore` — never commit it.
- Claude, GPT and the translator go through the claude / codex gateways of a mirasim space, so they only work inside a mirasim space.
- It also runs without any key: `SIM_LLM=off npm run dev`, and the characters follow their habits. Comic, paper and translation switches are in
  `model-corner-design/sim/config.json`.

Other environment variables: `SIM_DAY=6 SIM_START=17:00` starts the world on day 6 at 17:00; `SIM_DATA=<dir>` uses another save directory.
The world's save lives in `model-corner-design/sim/data/`; delete it and the world starts over on day 1 at 07:00.

## Layout

| Path | What's there |
|---|---|
| `model-corner-design/demo2/` | The page: `index.html` and `assets/` (maps, character atlases, props, font). Everything in this directory is public |
| `model-corner-design/sim/` | The simulated world (plain Node, no dependencies). Entry point `server.mjs`; `content/*.json` is the world data |
| `model-corner-design/nav/` | Walkable grids of the three areas |
| `model-corner-design/tools/` | Atlas sync, single-file build, image generation, walk grids and other tools |
| `model-corner-design/docs/` | Design notes; world mechanics are in `world-depth.md` |
| `model-corner-design/gen/` | Prompts used to generate the art (raw images are not in the repo) |
| `model-corner-design/promo/` | Cover and icon |
| `vite.config.ts` | Dev server: serves only `demo2/` and forwards `/api` to the sim |
| `AGENTS.md` | Working notes for coding agents |

Not in the repo: keys, the world save and model call logs (`sim/data/`), raw generated images, reference images, local backups and single-file builds.

## Assets and credits

- Characters: original designs by ZipZipPipe, 《大AI和小AI们》 ("Big AIs and Little AIs"; whale girl concept by 上善无形), CC BY-NC-SA 4.0.
  The character art in this repo is a derivative work and is used under the same CC BY-NC-SA 4.0 terms: attribution, non-commercial, share-alike.
- DeepSeek eating animation reference: [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)
- Scenes, character atlases and comics: generated with gpt-image-2
- Fonts: [ZCOOL KuaiLe](https://github.com/googlefonts/zcool-kuaile) for Chinese, [Fredoka](https://github.com/hafontia/Fredoka-One) for English headings, both SIL Open Font License 1.1

A non-commercial fan demo, not affiliated with DeepSeek, Anthropic, OpenAI or any other company.
