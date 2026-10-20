# HEIC P7 — 開発者向けソース・ライセンス資料の整備

2026-10-20。依存：PR #8。**正式配布はHOLD。**

## 一般の利用者

通常の利用者はライブラリを差し替える必要がありません。HEICの正式公開が承認されれば、JTrim Cloneの「開く」からHEICを選び、JPEG・PNG・WebPで保存できます。差し替え設定画面は設けません。

## 開発者・配布審査用の作業

Node.js 22、Git、npm、Bashがある開発環境で次を実行します。

```bash
bash tools/heic/stage-review.sh /tmp/heic-review-source
node tools/heic/prepare-review-packet.mjs /tmp/heic-review-source /tmp/heic-review-packet
```

出力先はリポジトリの外にある未作成ディレクトリとします。WASMのSHA-256、対応ソースのコミット一覧、必要なライセンスファイルを検査し、不一致や欠落があれば停止します。

生成される構成：

```text
heic-review-packet/
  README.md
  REVIEW-INDEX.json
  application-source/    # JTrimのソースのみ
  vendor/                # ハッシュを固定したWASM候補
  sources/               # libheif-js / libheif-emscripten / libheif / libde265
  licenses/              # 上流のライセンス資料
  provenance/sources.tsv
```

これは**公開配布物ではなく、非公開の審査候補一式**です。GitHub Actionsでは一時領域に生成し、照合後に破棄します。画像原本、Exif、利用者データは含めません。第三者コードのライセンスに関する権利の行使や、対応ソース提供義務を制限する趣旨ではありません。

## 改変版の技術的な利用方法

開発者が自身の管理するJTrim Cloneのコピーをホストする場合は、互換性のある独自ビルドのES Moduleを`third_party/libheif-js/libheif-bundle.mjs`に配置できます。Worker側はその固定されたパスから読み込みます。

P6では`libheif/post.js`を変更し、Emscripten 3.1.61とTypeScript 5.4.5を使って改変WASMをビルドし、公開HEICサンプルの復号とブラウザE2Eに成功しました。`tools/heic/rebuild-modified.sh`は識別用コードを追加する技術実証スクリプトであり、任意の変更を扱う完成済み配布ツールではありません。

**独自ビルドが動作することと、GNU LGPL-3.0第4項の再結合・ソース提供などの条件を満たすことは別です。** 配布形態に応じた法務確認が必要です。

## リリース前に解決する事項

- アプリ本体の`LICENSE`が存在しません。プロジェクト所有者によるライセンス方針の決定が必要であり、本PRでは選択しません。
- 対応ソースと配布するバイナリの関係、改変版の交換方法、LGPL/GPLの必要文書が適切に提供されるか確認します。
- HEVC特許・ロイヤルティ等の扱いは別途評価が必要です。
- 24.5MP写真を使ったJTrimの全UI、低メモリ環境、ICC/P3/HDR等の受入は未完了です。
- `node tools/heic/release-gate.mjs --assert-release`が成功し、権限ある担当者が確認するまでは本番公開しません。

この文書は技術資料であり、法的適合性を認定するものではありません。
