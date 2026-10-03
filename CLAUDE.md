# マリカTA記録（TA管理アプリ）

MK8DX のタイムアタック記録を iPhone で管理する個人用 PWA。素の HTML/CSS/JS（ビルドなし・外部ライブラリなし）。
仕様の正本は `仕様書.md`。ファイル構成もそちらの5章。

## 決まり

- **`app/courses.js` のコースの並び順を変えない。** 記録は `c01`〜`c96` の id でコースと結び付いており、id は並び順から作られる。名前の修正は自由。
- 記録は端末の中（localStorage）だけ。外部サービスへ送る機能を足すときは本人に確認する。
- 公開先は `https://qorigame256.github.io/mk8ta/`（リポジトリ `qorigame256/mk8ta` は**公開**）。main へ push すると `.github/workflows/pages.yml` が `app/` だけを公開する。**秘密・個人情報をリポジトリに入れない。**
- このリポジトリの git の作者は `qorigame256` / `328730295+qorigame256@users.noreply.github.com`（ローカル設定）。普段の Apple の転送用アドレスを公開リポジトリに出さないため。変えないこと。
- ファイルを変えて push しても、iPhone では「次に開いたとき」に新しい版になる（sw.js の方式）。
- 動作確認は `.claude/launch.json` の `app`（`node tools/serve.js`、http://localhost:8765/）をブラウザ画面で開き、iPhone 幅（375px）で見る。
- サービスワーカー（`app/sw.js`）は「保存済みの版を先に出し裏で更新」方式。ファイルを足したら `FILES` にも足す。
