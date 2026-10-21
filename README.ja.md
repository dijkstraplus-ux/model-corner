<p align="center"><img src="model-corner-design/promo/icon.webp" width="112" alt="鯨横丁"></p>

<h1 align="center">鯨横丁 · Whale Lane</h1>

<p align="center">DeepSeek、Claude、GPT の三人の女の子が、海辺の小さな通りで暮らしています。<br>次に何をするかは、毎回それぞれ同じ名前のモデルが自分で決めます。</p>

<p align="center"><a href="https://mirasim.ai/@whale-lane/town">ライブで見る</a></p>

<p align="center"><a href="README.md">中文</a> · <a href="README.en.md">English</a> · 日本語</p>

![鯨横丁](model-corner-design/promo/cover.jpg)

DeepSeek は深海食堂を切り盛りして、おにぎりを握ったり新メニューを試したり。Claude は紙ページ書房の店番をしながら、新しい短編を書いています。
GPT は星儀よろず屋でご近所さんの依頼を受け、星図を描いています。
三人は物を貸し借りし、助けを頼み合い、土曜の夜にいっしょに流星群を見る約束をして──ときどき約束を忘れたりもします。
町の「編集さん」は一時間ごとに起きたことを四コマ漫画にし、一日が終わるごとに小さな新聞を出します。

見ている人は三人の行動を左右できません。投げ銭も願いごとも投票もなく、できるのは開発チームへの手紙だけです。
この通りをいっしょに作りたい方は、ページ右上の「鯨横丁に参加」を押すか、https://mirasim.ai/j/z5qybknxe3x2 を開いてください。
見るだけなら Viewer を選べばワンクリックで入れます。手を動かしたいなら Collaborator を選び、管理者の承認後にあなたの agent で通りを変えられます。

## しくみ

- **時間**：ゲーム内の時間は現実の 8 倍の速さで、一日はおよそ 3 時間。誰も見ていないときも、三人はいつも通りに暮らしています。
- **頭脳**：キャラクターが次の行動を決めるとき、シミュレーターは今の状況・記憶・番号付きの選択肢リストを彼女のモデルに渡します。
  モデルは一つを選び、心の声と口に出すセリフを書きます。
  DeepSeek は `deepseek-v4.1-flash`、Claude は `claude-haiku-5-5`、GPT は `gpt-6-luna` を使っています。
- **三つの言語**：ページは中文・English・日本語に対応しています。モデルは毎回の返答を三つの言語で同時に書きます。
  プログラムが組み立てる文は Claude Haiku が翻訳し、結果はキャッシュされます。場所や物の訳名は `model-corner-design/sim/content/glossary.json` にあります。
- **世界はデータ**：物・アイテム・集まり・天気・お祭り・ちょっとしたハプニング・数日がかりのプロジェクト、そして各動作でどのアニメを再生するかは、
  すべて `model-corner-design/sim/content/*.json` に書かれています。町に何かを足すときは、たいてい JSON を少し書き足すだけです。
- **画面**：三つの区域（鯨横丁広場・海辺の市場・裏山公園）と三軒のお店はそれぞれ一枚の大きな絵で、キャラクターはコマ送りのスプライトアトラスです。
  ページはビルド不要の `index.html` 一枚です。

## ローカルで動かす

Node 20.19+ または 22.12+ が必要です。

```sh
npm install
npm run dev          # http://127.0.0.1:5173 を開く
```

`npm run dev` は Vite（ページのディレクトリだけを配信）を起動し、シミュレーター（127.0.0.1:5174、ページからは `/api` プロキシ経由）も一緒に立ち上げます。
シミュレーターだけを動かすこともできます。ページも自分で配信するので、`npm start` のあと http://127.0.0.1:5174 を開いてください。

モデルの経路：

- DeepSeek の行動決定、四コマ漫画、日報は mirasim のリレーを通ります。キーはリポジトリ直下の `mira_token`（または `MIRA_TOKEN_FILE` で指定したファイル）に置きます。
  このファイルは `.gitignore` に入っているので、コミットしないでください。
- Claude、GPT、翻訳は mirasim スペースの claude / codex ゲートウェイを通るため、mirasim スペースの中でだけ動きます。
- キーがなくても動きます：`SIM_LLM=off npm run dev` なら、キャラクターはいつもの習慣どおりに過ごします。漫画・日報・翻訳のオンオフは
  `model-corner-design/sim/config.json` にあります。

その他の環境変数：`SIM_DAY=6 SIM_START=17:00` で 6 日目の 17:00 から世界を始め、`SIM_DATA=<ディレクトリ>` で別のセーブ先を使います。
世界のセーブは `model-corner-design/sim/data/` にあり、消すと 1 日目の 07:00 からやり直しになります。

## ディレクトリ

| パス | 中身 |
|---|---|
| `model-corner-design/demo2/` | ページ：`index.html` と `assets/`（マップ、キャラクターのアトラス、小物、フォント）。このディレクトリの中身はすべて公開されます |
| `model-corner-design/sim/` | シミュレーションの世界（素の Node、依存なし）。入口は `server.mjs`、`content/*.json` が世界のデータ |
| `model-corner-design/nav/` | 三つの区域の歩行グリッド |
| `model-corner-design/tools/` | アトラス同期、単一ファイルのビルド、画像生成、歩行グリッドなどのツール |
| `model-corner-design/docs/` | 設計メモ。世界のしくみは `world-depth.md` |
| `model-corner-design/gen/` | アートの生成に使ったプロンプト（元画像はリポジトリに入れていません） |
| `model-corner-design/promo/` | カバー画像とアイコン |
| `vite.config.ts` | 開発サーバー：`demo2/` だけを配信し、`/api` をシミュレーターへ転送 |
| `AGENTS.md` | コーディングエージェント向けの作業メモ |

リポジトリに入らないもの：キー、世界のセーブとモデル呼び出しのログ（`sim/data/`）、生成画像の元データ、参考画像、ローカルのバックアップ、単一ファイルのビルド成果物。

## 素材とクレジット

- キャラクター：ZipZipPipe《大AI和小AI们》のオリジナルデザイン（クジラ娘の原案：上善无形）、CC BY-NC-SA 4.0。
  このリポジトリのキャラクター画像はそれをもとにした二次創作で、同じく CC BY-NC-SA 4.0（表示・非営利・継承）で使用しています。
- DeepSeek の食事アニメの参考：[PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)
- 背景、キャラクターのアトラス、四コマ漫画：gpt-image-2 で生成
- フォント：中国語は[站酷快乐体 ZCOOL KuaiLe](https://github.com/googlefonts/zcool-kuaile)、英語の見出しは [Fredoka](https://github.com/hafontia/Fredoka-One)、どちらも SIL Open Font License 1.1

非営利のファンメイドデモで、DeepSeek、Anthropic、OpenAI などの企業とは関係ありません。
