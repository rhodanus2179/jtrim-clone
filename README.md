# jtrim-clone

JTrim 1.53c の操作感と主要機能を、HTML + CSS + JavaScript で現代のブラウザ上に再実装するプロジェクトです。

- インストール不要
- GitHub Pages で配信予定
- 原則として画像処理はブラウザ内で完結
- JTrim の軽さ・単純さ・直接操作感を重視
- レイヤー型の高機能画像編集ソフトではなく「さっと画像を加工する道具」を目指す

## Status

ブラウザで操作できる最初の実装版（v0.1.0）まで進んでいます。

### 実装済み

- 画像ファイルを開く / ドラッグ＆ドロップ
- 新規画像作成
- PNG / JPEG / WebP 保存
- ズーム / ウィンドウに合わせる
- 矩形選択
  - ドラッグで作成
  - 選択範囲の移動
  - 四隅ハンドルで変更
  - Ctrl + カーソルキーで1px移動
  - Shift + カーソルキーで1px拡縮
- 切り抜き
- 左右90度回転
- ミラー / フリップ
- リサイズ
  - サイズ指定
  - 比率指定
  - 縦横比保持
  - 再サンプリング有無
  - Box / Hermite / Triangle / Bell / Mitchell / BSpline / Lanczos3
- グレースケール
- セピア
- ネガポジ反転
- 明るさ / コントラスト（ライブプレビュー）
- ガウスぼかし レベル1〜10（ライブプレビュー）
- 文字入れ
- Undo / Redo（16段階を基本）
- JTrim準拠の主要ショートカット
- GitHub Actions による JavaScript 構文チェック

画素処理のうち、リサイズ方式・ガウスぼかし・明るさ/コントラストなどは、現段階では機能互換を優先した独自実装です。原版 JTrim との画素単位の比較・調整は後続フェーズで行います。

## Run locally

ES Modules を使用しているため、`index.html` を `file://` で直接開くのではなく、簡易 HTTP サーバーを使用してください。

```bash
python -m http.server 8000
```

その後、`http://localhost:8000/` を開きます。

## Documentation

- [JTrim 1.53c 機能インベントリ](docs/jtrim-1.53c-feature-inventory.md)
- [実機スクリーンショットに基づくUIリファレンス](docs/ui-screenshot-reference.md)
- [アーキテクチャ設計](docs/architecture.md)
- [実装計画](docs/implementation-plan.md)

## Fidelity goals

1. 機能互換
2. 操作互換
3. 可能な機能について画素互換

ブラウザのセキュリティモデル上、Windowsのファイル関連付け、壁紙の直接設定、TWAIN機器への直接アクセス等は原版と同じ方法では実装できません。可能なものは現代Web APIで代替します。

## Acknowledgement

JTrim は WoodyBells により開発されたフリーウェアです。このプロジェクトは非公式のWeb再実装であり、WoodyBellsとは関係ありません。

原版:
https://www.woodybells.com/jtrim.html

利用条件:
https://www.woodybells.com/about.html

## Implementation policy

原版のバイナリや実行コードをコピーせず、公開されている仕様・ヘルプ・画面資料を参考に独自実装します。
