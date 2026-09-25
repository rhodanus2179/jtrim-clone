# jtrim-clone 設計書

更新日: 2026-09-26

## 1. 目的

JTrim 1.53c の機能体系・操作思想を、現代ブラウザ上で再実装する。

本プロジェクトで優先するもの:

1. JTrim の主要機能を網羅する
2. JTrim 利用者が迷いにくいメニュー構成・用語を保つ
3. 画像処理は原則としてブラウザ内で完結する
4. GitHub Pages で静的配信できる
5. 見た目は Windows クラシック UI を完全再現せず、現代的で軽量な UI とする
6. 将来、原版との画素差分テストを追加できる構造にする

## 2. 非目標

- Windows ネイティブアプリの完全再現
- 原版 JTrim のバイナリ、コード、アイコン資産の流用
- 初期段階から全機能の画素完全一致
- レイヤーを中心とする Photoshop 型エディタ
- サーバー側画像処理

## 3. 技術方針

### 3.1 基本構成

- HTML5
- CSS
- JavaScript ES Modules
- Canvas 2D API
- Web Worker
- OffscreenCanvas（利用可能なブラウザでは使用）
- File API / Blob / Object URL
- Clipboard API（権限が許可される場合）
- localStorage / IndexedDB

フレームワークは使用しない。
ビルド必須の構成にせず、GitHub Pages にそのまま配信可能な静的ファイル構成とする。

### 3.2 理由

JTrim は軽量さと即応性が特徴であり、React/Vue 等の UI フレームワークを導入する利点が小さい。
また、画像処理ロジックを UI から独立させることで、将来的なテスト・Web Worker 化・WASM 化を容易にする。

## 4. 全体アーキテクチャ

```text
+--------------------------------------------------+
| App Shell                                        |
|  Menu / Toolbar / Statusbar / Dialog Host        |
+----------------------------+---------------------+
                             |
                             v
+--------------------------------------------------+
| Command Registry                                 |
|  command id / label / shortcut / enabled / run   |
+----------------------------+---------------------+
                             |
                             v
+--------------------------------------------------+
| Document Store                                   |
|  Image / Selection / Viewport / History / Meta   |
+----------------------------+---------------------+
        |                    |                 |
        v                    v                 v
+---------------+   +----------------+   +----------------+
| Renderer      |   | Image Engine   |   | File I/O       |
| base canvas   |   | transforms     |   | decode/encode  |
| overlay       |   | color          |   | clipboard      |
| preview layer |   | filters        |   | batch          |
+---------------+   +----------------+   +----------------+
                             |
                             v
                    +----------------+
                    | Worker Adapter |
                    | OffscreenCanvas |
                    +----------------+
```

## 5. 画面構成

### 5.1 App Shell

```text
┌────────────────────────────────────────────────────┐
│ ファイル 編集 表示 イメージ カラー 加工 ヘルプ     │
├────────────────────────────────────────────────────┤
│ ツールバー                                         │
├────────────────────────────────────────────────────┤
│                                                    │
│                 Canvas Workspace                   │
│                                                    │
├────────────────────────────────────────────────────┤
│ x, y / RGB / image size / zoom / color depth       │
└────────────────────────────────────────────────────┘
```

JTrim のメニュー分類と日本語名称は原則維持する。
Windows クラシック調の見た目は必須としない。

### 5.2 Canvas Workspace

画像本体と UI オーバーレイを分離する。

- base canvas: 確定済み画像
- preview canvas: ダイアログ操作中の一時プレビュー
- overlay canvas: 選択範囲、ハンドル、カーソル補助
- optional checkerboard: 透過状態表示

選択枠やガイドを base canvas に描き込まない。

## 6. 状態モデル

```js
AppState = {
  document: {
    id,
    width,
    height,
    colorDepth,
    sourceFormat,
    fileName,
    originalFile,
    modified,
    imageRevision
  },

  selection: {
    active,
    x,
    y,
    width,
    height
  },

  viewport: {
    zoom,
    scrollX,
    scrollY,
    showTransparency,
    backgroundColor
  },

  tool: {
    activeTool,
    options
  },

  history: {
    undo,
    redo
  },

  ui: {
    activeDialog,
    activeMenu,
    busy,
    statusMessage
  },

  preferences: {
    resizeMethod,
    preserveAspectRatio,
    historyDepth,
    jpegQuality
  }
}
```

画像ピクセル本体は巨大になり得るため、AppState に JSON として保持しない。
Canvas / ImageBitmap / ImageData を DocumentBuffer が管理する。

## 7. Command Registry

すべてのメニュー・ツールバー・ショートカットは同じ Command を呼ぶ。

例:

```js
{
  id: "image.resize",
  label: "リサイズ",
  shortcut: "Ctrl+R",
  enabled: state => state.document != null && !state.ui.busy,
  execute: context => openResizeDialog(context)
}
```

利点:

- メニューとツールバーで処理を重複しない
- ショートカット管理を一元化できる
- disabled 状態を統一できる
- 将来的にコマンドパレット等を追加可能

## 8. 画像処理エンジン

UI から独立した純粋関数を基本とする。

### 8.1 Transform

- resize
- crop
- rotate 90
- arbitrary rotate
- mirror / flip
- shift
- add margin
- circular crop
- rounded crop

### 8.2 Color

- grayscale
- sepia
- negative
- brightness
- contrast
- RGB balance
- HSV
- gamma
- posterize
- solarize
- threshold
- RGB swap
- XOR color
- shadow/highlight
- red-eye
- gradient
- color depth conversion

### 8.3 Filter

- soften
- soft lens
- sharpen
- emboss
- edge enhance
- edge extract
- gaussian blur
- motion blur
- diffuse
- noise
- wave
- mosaic
- block
- fade
- glass
- pencil
- oil paint
- swirl
- punch
- pinch
- spotlight
- blind
- supernova
- silk screen
- ripple
- newspaper
- custom 3x3 filter

### 8.4 Composition

- paste
- composite paste
- alpha composite
- add
- subtract
- lighten
- darken
- join images
- text rendering
- fill

## 9. 選択範囲

座標は常に「画像座標」で保持し、画面座標とは分離する。

```text
screen coordinate
      |
      | / zoom + scroll offset
      v
image coordinate
```

選択機能:

- drag to select
- handle resize
- move selection
- Ctrl + arrow: 1px move
- Shift + arrow: 1px resize
- Ctrl+A: 全選択 / 選択解除
- 対応する画像処理は選択範囲のみに適用

選択範囲を伴う処理の共通 API:

```js
applyToRegion(image, selection, processor)
```

## 10. プレビュー方式

色調整・フィルタ系ダイアログは非破壊プレビューを行う。

```text
base image
   |
   +---- parameters ----> worker ----> preview canvas
   |
OK +----> commit result -> base canvas -> history push
Cancel -----------------> preview discard
```

スライダー操作ごとに履歴を積まない。
「OK」の時点で 1 操作として履歴に入れる。

負荷の高い処理では以下を行う。

- debounce 30–80ms
- プレビュー用縮小画像
- Worker 処理
- OK 時のみ原寸処理

## 11. Undo / Redo

JTrim に合わせ、標準 16 段階を目標とする。

### 初期実装

- 画像変更操作ごとにスナップショットを保存
- history depth = 16

### メモリ対策

3000 × 3000 RGBA は約 36MB。
16段を単純 ImageData で保持すると約 576MB になる。

そのため最終的にはハイブリッド方式を採用する。

- 直近数段: ImageBitmap / raw buffer
- 古い履歴: PNG/WebP Blob に圧縮
- メモリ上限を超えたら古い履歴から圧縮または破棄
- メタデータは別管理

履歴 API:

```js
history.begin(label)
history.commit(snapshot)
history.undo()
history.redo()
history.clear()
```

## 12. リサイズ

JTrim の 7 再サンプリング方式を独自実装する。

- Box
- Hermite
- Triangle
- Bell
- Mitchell
- BSpline
- Lanczos3

共通 API:

```js
resize(source, dstWidth, dstHeight, {
  method: "lanczos3",
  preserveAspectRatio: true
})
```

Canvas の `drawImage` だけに依存しない。
アルゴリズムごとの差を再現できるよう、kernel-based resampler として分離する。

## 13. 文字入れ

確定前はオブジェクトとして保持する。

```js
TextObject = {
  text,
  x, y,
  fontFamily,
  fontSize,
  bold,
  italic,
  underline,
  vertical,
  textColor,
  backgroundColor,
  borderColor,
  borderWidth,
  padding,
  lineHeight,
  antialias,
  opacity
}
```

OK で Canvas に rasterize して確定する。
キャンセルで破棄する。

## 14. ファイル I/O

### 14.1 読み込み

フェーズ1:

- PNG
- JPEG
- GIF（先頭フレーム）
- WebP
- BMP（ブラウザが decode 可能な範囲）

フェーズ2:

- ICO
- JPEG2000
- 必要に応じ追加デコーダ

原版の Susie Plug-in 互換は対象外。

### 14.2 保存

優先:

- PNG
- JPEG
- WebP

JTrim 互換機能として:

- JPEG品質
- JPEG目標ファイルサイズ探索
- Exif保持（可能な範囲）
- PNG透過

JPEG2000 はブラウザ標準ではないため拡張機能として扱う。

## 15. 透過

Canvas 内部は常に RGBA とする。

- 透過状態表示: checkerboard
- 透過色設定: 指定色を alpha=0 に変換
- JPEG 保存時: 背景色と合成して RGB 化

## 16. ヒストグラム

worker 内で R/G/B/Luma 256 bin を計算する。

```js
{
  red: Uint32Array(256),
  green: Uint32Array(256),
  blue: Uint32Array(256),
  luma: Uint32Array(256)
}
```

用途:

- 表示
- normalize
- equalize
- status/analysis

## 17. Worker 設計

重い処理は Worker に委譲する。

```text
UI Thread
   |
   | job { id, operation, params, pixels }
   v
Image Worker
   |
   | result { id, pixels, stats }
   v
UI Thread
```

Transferable ArrayBuffer を使用し、可能な限りコピーを避ける。

OffscreenCanvas が使用可能なら Worker 内 Canvas を使う。
非対応環境では main thread fallback。

## 18. バッチ変換

一括変換は通常編集画面と同じ処理関数を再利用する。

```text
FileList
  |
  v
decode -> pipeline[] -> encode -> download
```

Pipeline 例:

```js
[
  { operation: "resize", width: 1200 },
  { operation: "brightness", value: 5 },
  { operation: "margin", top: 10, ... }
]
```

処理ロジックを通常編集用と二重実装しない。

## 19. ダイアログ設計

共通 Modal コンポーネントを使用。

原則:

- title
- preview
- controls
- OK
- Cancel
- Help

連続値:

- slider + number input

変更中:

- preview update

確定:

- one history entry

JTrim のパラメータ名と値域を可能な限り維持するが、配置や装飾は現代的にする。

## 20. フォルダ構成

```text
/
├─ index.html
├─ favicon.svg
├─ css/
│  ├─ app.css
│  ├─ menu.css
│  ├─ dialogs.css
│  └─ workspace.css
│
├─ js/
│  ├─ main.js
│  ├─ app/
│  │  ├─ store.js
│  │  ├─ commands.js
│  │  ├─ shortcuts.js
│  │  ├─ history.js
│  │  └─ preferences.js
│  │
│  ├─ document/
│  │  ├─ buffer.js
│  │  ├─ selection.js
│  │  ├─ viewport.js
│  │  └─ metadata.js
│  │
│  ├─ engine/
│  │  ├─ transform/
│  │  ├─ color/
│  │  ├─ filters/
│  │  ├─ compose/
│  │  ├─ histogram/
│  │  └─ resample/
│  │
│  ├─ io/
│  │  ├─ open.js
│  │  ├─ save.js
│  │  ├─ clipboard.js
│  │  ├─ exif.js
│  │  └─ batch.js
│  │
│  ├─ ui/
│  │  ├─ menu.js
│  │  ├─ toolbar.js
│  │  ├─ statusbar.js
│  │  ├─ workspace.js
│  │  └─ dialogs/
│  │
│  ├─ worker/
│  │  ├─ image-worker.js
│  │  └─ worker-client.js
│  │
│  └─ utils/
│
├─ tests/
│  ├─ unit/
│  ├─ fixtures/
│  └─ pixel-diff/
│
└─ docs/
   ├─ jtrim-1.53c-feature-inventory.md
   ├─ ui-screenshot-reference.md
   ├─ architecture.md
   └─ implementation-plan.md
```

## 21. テスト戦略

### 21.1 Unit test

純粋関数として検証できるもの:

- RGB/HSV
- gamma
- grayscale
- sepia
- resize kernel
- convolution
- histogram
- coordinate transform

### 21.2 Golden image test

```text
input.png
   |
operation(parameters)
   |
actual.png ---- pixel diff ---- expected.png
```

原版 JTrim から得た出力画像を expected にできれば、画素互換の評価が可能。

評価指標:

- exact pixel match rate
- MAE
- RMSE
- max channel error

### 21.3 UI test

最低限:

- keyboard shortcuts
- menu enable/disable
- selection
- dialog OK/Cancel
- undo/redo

## 22. パフォーマンス目標

代表画像:

- 1920×1080
- 3000×3000
- 6000×4000

目標:

- UI操作: 16ms以内を基本
- 軽量色変換: 3000×3000で 300ms 程度を目標
- 重いフィルタ: UIをブロックしない
- preview: 100ms 前後を目標
- 大画像でもクラッシュしない

Worker + preview downscale を前提とする。

## 23. ブラウザ対応

優先:

1. Chrome / Edge 最新
2. Firefox 最新
3. Safari 最新

GitHub Pages では HTTPS となるため Clipboard API / Screen Capture API 等を利用可能。

File System Access API は Chromium 系中心なので、必須機能にはしない。
代替として通常の file input / download を常に用意する。

## 24. GitHub Pages

静的サイトとして main branch から配信可能な構造にする。

初期案:

- root の `index.html` を直接配信
- npm build 不要
- GitHub Pages 設定: main / root

将来テストや lint に npm を導入しても、本番成果物は静的ファイルのままとする。

## 25. セキュリティ・プライバシー

- 画像は原則ローカル処理
- 外部サーバーへアップロードしない
- Analytics は初期状態で導入しない
- Clipboard / Screen Capture はユーザー操作時のみ要求
- ファイルアクセス権限は最小限

UI上にも「画像はブラウザ内で処理されます」と明記可能。

## 26. 実装優先順位

### Phase 0 — 骨格

- App Shell
- Command Registry
- Store
- Canvas Workspace
- File open/save
- GitHub Pages

### Phase 1 — 基本編集

- selection
- crop
- resize
- 90° rotate
- mirror / flip
- undo / redo
- zoom
- status bar

### Phase 2 — 日常利用

- text
- brightness / contrast
- grayscale / sepia / negative
- gamma
- gaussian blur
- sharpen
- mosaic
- margin
- arbitrary rotate

### Phase 3 — JTrim互換拡張

- 全カラー機能
- 全加工機能
- composition
- join
- histogram
- transparency
- color depth
- batch conversion
- thumbnails
- slideshow

### Phase 4 — 高度互換

- Exif
- JPEG目標サイズ
- 7方式 resampler の検証
- pixel compatibility tests
- JPEG lossless rotation（技術的に妥当な方法を別途検討）

## 27. 設計上の重要判断

### 27.1 一枚の巨大な app.js にしない

画像処理は長期的にかなり増えるため、最初からモジュール分割する。

### 27.2 UI と画像処理を分離する

UI 部分から直接 pixel loop を書かない。

### 27.3 preview と commit を分離する

ダイアログ操作中の変更を履歴に積まない。

### 27.4 menu / toolbar / shortcut を Command に統合する

同一操作を複数実装しない。

### 27.5 内部画像形式は RGBA に統一する

入力形式ごとの差異をエンジン内部へ持ち込まない。

## 28. 将来拡張

- PWA / offline
- installable app
- drag & drop folder
- WASM SIMD
- WebGPU filter engine
- locale support
- desktop wrapper (Tauri/Electron)

ただし、初期版では採用しない。
まず「Webで軽く動くJTrim」を完成させる。
