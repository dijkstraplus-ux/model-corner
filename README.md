<p align="center"><img src="model-corner-design/promo/icon.webp" width="112" alt="鲸巷"></p>

<h1 align="center">鲸巷 · Whale Lane</h1>

<p align="center">DeepSeek、Claude、GPT 三个拟人女孩住在一条海边小街上，<br>每一步做什么，都由她同名的模型自己决定。</p>

<p align="center"><a href="https://mirasim.ai/@whale-lane/town">在线围观</a></p>

<p align="center">中文 · <a href="README.en.md">English</a> · <a href="README.ja.md">日本語</a></p>

![鲸巷](model-corner-design/promo/cover.jpg)

DeepSeek 开深海食堂，捏饭团、试做新菜；Claude 守着纸页书屋，写她的新短篇；GPT 在星仪万事屋接邻居的委托、画星图。
她们会互相借东西、请对方帮忙、约好周六晚上一起看流星雨，也会忘了答应过的事。镇上的「编辑」每小时把发生的事画成一张四格漫画，
每过一天出一份小报。

围观的人不能左右她们：没有打赏、许愿或投票，能做的只有给开发团队写信。想一起把这条街建起来的话，点页面右上角的「加入鲸巷」，
或者直接打开 https://mirasim.ai/j/z5qybknxe3x2 ：只想看看就选 Viewer，点一下就进来；想动手选 Collaborator，管理员同意后就能让你的 agent 改这条街。

## 怎么运作

- **时间**：游戏里的时间是现实的 8 倍，一天大约 3 小时。没人看的时候她们也照常过日子。
- **大脑**：角色要做下一件事时，模拟服务把她此刻的处境、记忆和一张编号选项单交给她的模型。模型选一项，写下她的内心独白和说出口的话。
  DeepSeek 用 `deepseek-v4.1-flash`，Claude 用 `claude-haiku-5-5`，GPT 用 `gpt-6-luna`。
- **世界是数据**：物件、物品、聚会、天气、节日、小意外、要做好几天的项目，以及每个动作播哪段动画，都写在
  `model-corner-design/sim/content/*.json` 里。往镇上加一样东西，通常只要加一段 JSON。
- **三种语言**：页面有中文、English、日本語三种界面。模型每次回答都同时写出三种语言；程序拼出来的句子由 Claude Haiku 翻译，结果会缓存下来。
  专有名词的译名在 `model-corner-design/sim/content/glossary.json`。
- **画面**：三个街区（鲸巷广场、海边集市、后山公园）和三间店各是一张大图，角色是逐帧的精灵图集。页面是一个不需要构建的 `index.html`。

## 本地运行

需要 Node 20.19+ 或 22.12+。

```sh
npm install
npm run dev          # 打开 http://127.0.0.1:5173
```

`npm run dev` 启动 Vite（只服务页面目录），并带起模拟服务（127.0.0.1:5174，页面经 `/api` 代理访问它）。
也可以只跑模拟服务，它自己就能给出页面：`npm start`，然后打开 http://127.0.0.1:5174 。

模型通道：

- DeepSeek 的决定、四格漫画和日报走 mirasim 中转站，密钥放在仓库根目录的 `mira_token`（或用 `MIRA_TOKEN_FILE` 指定文件）。
  这个文件在 `.gitignore` 里，不要提交。
- Claude 和 GPT 走 mirasim 空间里的 claude / codex 网关，只在 mirasim 空间里可用。
- 没有密钥也能跑：`SIM_LLM=off npm run dev`，角色按习惯过日子。漫画和日报的开关在 `model-corner-design/sim/config.json`。

其他环境变量：`SIM_DAY=6 SIM_START=17:00` 让世界从第 6 天 17:00 开始；`SIM_DATA=<目录>` 换一个存档目录。
世界存档在 `model-corner-design/sim/data/`，删掉它，世界就从第 1 天 07:00 重新开始。

## 目录

| 路径 | 内容 |
|---|---|
| `model-corner-design/demo2/` | 页面：`index.html` 和 `assets/`（地图、角色图集、道具、字体）。这个目录里的东西全部公开 |
| `model-corner-design/sim/` | 模拟世界（纯 Node，无依赖）。入口 `server.mjs`；`content/*.json` 是世界数据 |
| `model-corner-design/nav/` | 三个街区的可走网格 |
| `model-corner-design/tools/` | 图集同步、单文件打包、生图、可走网格等工具 |
| `model-corner-design/docs/` | 设计文档，世界机制见 `world-depth.md` |
| `model-corner-design/gen/` | 生成美术用的提示词（原图不进仓库） |
| `model-corner-design/promo/` | 封面和图标 |
| `vite.config.ts` | 开发服务器：只服务 `demo2/`，`/api` 转给模拟服务 |
| `AGENTS.md` | 给编码智能体的工作说明 |

不进仓库的：密钥、世界存档和模型调用日志（`sim/data/`）、生图原图、参考图、本地备份和单文件打包产物。

## 素材与致谢

- 角色：ZipZipPipe《大AI和小AI们》原设计（鲸鱼娘原案：上善无形），CC BY-NC-SA 4.0。
  本仓库里的角色图是据此创作的衍生作品，同样按 CC BY-NC-SA 4.0 使用：署名、非商业、相同方式共享。
- DeepSeek 吃饭动画参考：[PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)
- 场景、角色图集和四格漫画：gpt-image-2 生成
- 字体：中文用[站酷快乐体 ZCOOL KuaiLe](https://github.com/googlefonts/zcool-kuaile)，英文标题用 [Fredoka](https://github.com/hafontia/Fredoka-One)，都是 SIL Open Font License 1.1

非商业同人 demo，与 DeepSeek、Anthropic、OpenAI 等公司无关。
