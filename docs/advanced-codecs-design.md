# JPEGロスレス変換・Progressive JPEG・Interlaced PNG 設計

更新日: 2026-09-26  
対象: jtrim-clone v0.10.0 以降

## 実装状況（2026-09-27）

- CODEC-1 Codec Worker / lazy loader: **実装済み**
- CODEC-2 JPEGロスレス回転 / 反転: **実装済み**
- CODEC-3 Progressive / Sequential JPEG: **実装済み**
- CODEC-4 Adam7 Interlaced PNG: **実装済み**
- CODEC-5 Optimization / compatibility:
  - pristine JPEG追跡: **実装済み**
  - DCT再量子化なしのProgressive / Sequential transcode: **実装済み**
  - 元JPEGサブサンプリング維持: **実装済み**
  - generated codec smoke test / reproducible build / third-party notices: **実装済み**
  - 大画像stress test・主要ブラウザ手動試験・offline/cache確認: **未実施**

実装では通常のPNG・WebPや、元JPEG情報を利用できない通常JPEGはCanvas native encoderを維持する。一方、元JPEGのサブサンプリング維持が可能なJPEG保存では、Sequentialでも必要時にcjpeg codecをlazy-loadする。

## 1. 目的

JTrim 1.53c にある以下の機能を、ブラウザ上で「見かけだけ」ではなく圧縮形式の意味まで含めて再現する。

- JPEGロスレス回転 / 反転
- JPEG Progressive / Sequential（通常）出力
- PNG Interlaced / Non-interlaced 出力
- 一括変換での Progressive / Interlaced 指定

通常の Canvas `toBlob()` は JPEG / PNG の基本保存には十分だが、JPEG の DCT 係数を直接変換する機能や Progressive scan、PNG Adam7 を指定する API は持たない。
したがって、通常画像編集系とは別に **Advanced Codec Layer** を追加する。

## 2. 原版JTrimの意味

公開されている JTrim 1.53c ヘルプ由来資料では、JPEGロスレス回転は「JPEGファイルを画質劣化なしに90度単位で回転 / 上下左右反転」し、ディスク上のJPEGを直接更新する機能として説明されている。

重要な挙動:

- JTrim上で未保存の加工は破棄される
- JPEGコメントやExifを維持する
- 処理後は変換後JPEGを読み込み直す
- JPEG以外では使用不可
- 通常の「回転→JPEG保存」と違い、画素を再圧縮しない

したがってWeb版でも、Canvasを回転してJPEG再保存する処理を「ロスレス回転」とは呼ばない。

また「インターレース / プログレッシブ」は保存設定であり、

- JPEG → Progressive JPEG
- PNG → Adam7 Interlaced PNG

として扱う。

## 3. 技術選定

### 3.1 JPEG: libjpeg-turbo を WebAssembly 化

採用候補: **libjpeg-turbo**

理由:

- jpegtran / TurboJPEG API が DCT 係数レベルのロスレス変換を持つ
- 90 / 180 / 270度回転、水平 / 垂直反転に対応
- Progressive JPEG の出力に対応
- 元JPEGを Progressive ↔ Sequential に DCT再量子化なしで変換可能
- JPEG圧縮も同じライブラリで実装できる
- 成熟した実装であり、JPEGビットストリームを独自実装する必要がない

ランタイムではコマンドラインプログラムそのものを起動せず、必要な C API だけを小さいラッパーとして WASM に公開する。

### 3.2 PNG: libspng を WebAssembly 化

採用候補: **libspng**

理由:

- RGBA8 → PNGエンコードを明示的に制御できる
- IHDR の interlace method に Adam7 を指定できる
- progressive row encoding も提供されている
- API が比較的小さく、ブラウザ向けラッパーを作りやすい

PNG仕様上、interlace method 1 は Adam7 の7パス方式とする。

### 3.3 Canvas native encoder は残す

通常保存では現在の `canvas.toBlob()` を残す。

Advanced Codec を使う条件だけを限定する。

```text
通常 PNG / WebP
  -> Canvas native encoder

通常 JPEG
  -> 元JPEGのsampling情報がなければCanvas native encoder
  -> sampling維持が可能ならJPEG WASM encoder

Progressive JPEG
  -> JPEG WASM encoder

Interlaced PNG
  -> PNG WASM encoder

JPEG lossless transform
  -> JPEG WASM coefficient transform
```

これにより通常起動時に WASM を読み込まず、JTrim Web の軽さを維持する。

## 4. ライセンス方針

libjpeg-turbo は IJG License と BSD系ライセンスの条件を持つ。
WASMバイナリを配布する場合は upstream のライセンス表示と IJG acknowledgement をプロジェクト文書へ含める。

実装時に以下を追加する。

```text
third_party/
  libjpeg-turbo/
    LICENSE.md
    README.ijg
  libspng/
    LICENSE

docs/
  third-party-notices.md
```

README または Third Party Notices には少なくとも、

> This software is based in part on the work of the Independent JPEG Group.

を明記する。

依存ライブラリのソースを改変して配布する場合は、各 upstream ライセンスの追加条件も満たす。

## 5. アーキテクチャ追加

現在:

```text
Canvas
  -> files.js
  -> canvas.toBlob()
```

拡張後:

```text
                         +----------------------+
JPEG source Blob ------> | Advanced Codec Layer |
RGBA Canvas -----------> |                      |
                         | JPEG WASM            |
                         | PNG WASM             |
                         +----------+-----------+
                                    |
                                    v
                                  Blob
                                    |
                    +---------------+---------------+
                    |                               |
               download / Save As              FileHandle write
```

通常の Pixel Engine と Codec Layer は分離する。

## 6. 新規ファイル構成

予定:

```text
js/
  codecs/
    codec-client.js
    jpeg-codec.js
    png-codec.js
    jpeg-orientation.js
  worker/
    codec-worker.js

wasm/
  jpeg-codec.wasm
  png-codec.wasm

tools/
  wasm/
    build-jpeg-codec.sh
    build-png-codec.sh
    jpeg_wrapper.c
    png_wrapper.c
    versions.json

third_party/
  ...

tests/
  codec-smoke.mjs
  fixtures/
    jpeg/
    png/
```

GitHub Pages の配信物には事前ビルド済み WASM を含める。
本番利用に npm build は必要としない。

WASMの再ビルド手順は `tools/wasm/` に残し、利用する upstream バージョンを固定する。

## 7. Codec Client

UIは WASM を直接呼ばない。

```js
const codec = new CodecClient();

await codec.jpegLosslessTransform(blob, {
  operation: "rotate90",
  edgePolicy: "perfect",
  progressive: "preserve"
});

await codec.encodeJpeg(imageData, {
  quality: 92,
  progressive: true,
  subsampling: "auto"
});

await codec.encodePng(imageData, {
  interlaced: true
});
```

CodecClient は専用 Worker と通信する。

## 8. Worker

圧縮・変換はメインスレッドでは実行しない。

```text
UI Thread
   |
   | ArrayBuffer / ImageData
   | transferable
   v
Codec Worker
   |
   +-- lazy load jpeg-codec.wasm
   |
   +-- lazy load png-codec.wasm
   |
   v
result ArrayBuffer
```

JPEGだけ使う場合にPNG WASMはロードしない。

Workerメッセージ:

```js
{
  id,
  operation:
    "jpeg-transform" |
    "jpeg-encode" |
    "jpeg-transcode" |
    "png-encode",
  payload,
  options
}
```

## 9. JPEGロスレス回転 / 反転

### 9.1 UI

イメージメニュー:

```text
JPEGロスレス回転 / 反転...
```

ダイアログ:

```text
処理:
  ○ 右へ90度
  ○ 左へ90度
  ○ 180度
  ○ 左右反転
  ○ 上下反転

端の処理:
  ○ 完全にロスレスな場合のみ実行（推奨）
  ○ 変換できない端をトリミング

☑ コメント / Exif / ICC等を保持
☑ Exif Orientationを正規化
```

「通常回転して再保存」はこのダイアログには混ぜない。

### 9.2 有効条件

基本条件:

- 現在の元ファイルがJPEG
- 元のJPEG Blob / Fileを取得できる
- Canvasで生成した新規画像ではない

File System Access で開いている場合:
- FileHandle があれば元ファイルへ直接反映可能

従来 File input の場合:
- 元ファイルへの書き戻しはできないため、変換JPEGをダウンロード / Save As する

### 9.3 JTrim互換の未保存編集処理

ロスレス変換は **Canvasの現在画素ではなく元JPEG圧縮データ** に作用する。

そのため `document.modified === true` の場合:

> JPEGロスレス変換を行うと、現在の未保存の加工は破棄されます。続けますか？

を表示する。

続行時:

1. Undo / Redoを破棄
2. 元JPEGを取得
3. DCT係数変換
4. 保存
5. 結果JPEGを再読込

JTrimの原版挙動に合わせ、ロスレス変換自体は通常のUndo対象にしない。

## 10. iMCU境界問題

JPEGのロスレス変換は DCT / iMCU ブロック単位なので、画像サイズとサブサンプリングによっては右端 / 下端に partial iMCU が存在する。

libjpeg-turbo の仕様では、操作によっては partial iMCU を完全には移動できない。

そこでWeb版は安全側にする。

### デフォルト: perfect

```text
edgePolicy = "perfect"
```

TurboJPEG の PERFECT 相当を使い、完全変換できない場合は **失敗させる**。

UI:

> このJPEGは端に不完全なMCUブロックがあるため、画像全体を完全にはロスレス回転できません。

選択肢:

- キャンセル
- 変換できない端をトリミングして実行

### trim

`TRIM` 相当。

これは再圧縮は行わないが、端画素を捨てるため厳密には可逆ではない。
UI上でも「完全ロスレス」ではなく、

> 再圧縮なし・端をトリミング

と明記する。

### 採用しない

partial iMCU をそのまま残して奇妙な端帯が発生する jpegtran の通常挙動は UI からは提供しない。

理由:
ユーザーが結果を予測しにくい。

## 11. Exif Orientation

ここが最重要。

ブラウザの通常デコードは Exif Orientation を反映して表示する場合がある。
一方 JPEGロスレス変換は元JPEGの「物理的なDCT配置」に作用する。

単純に:

```text
raw JPEG coefficients
 -> rotate90
 -> Exif Orientationを1
```

とすると、Orientationが1以外の写真ではユーザーが画面で見た方向と結果が一致しない可能性がある。

そこで、Exif Orientationを8種類の幾何変換として扱う。

```text
Displayed = OrientationTransform(SourceCoefficients)
Desired   = UserTransform(Displayed)

Output Orientation = 1

したがって:

CoefficientTransform =
  UserTransform ○ OrientationTransform
```

として合成する。

例:

```text
Exif Orientation = 6 (表示時90度回転)
ユーザー = 右90度

raw係数に必要な変換 = 180度
output Orientation = 1
```

これにより「画面で見えている画像を右90度」というユーザー意図を維持する。

## 12. Metadata

### 12.1 基本方針

ロスレス変換では以下を可能な限り維持する。

- APP0 / JFIF
- APP1 / Exif
- APP2 / ICC
- COM
- Photoshop等の追加APP marker

TurboJPEG transform の marker copy を利用する。

### 12.2 Exif

変換後:

- Orientation = 1
- PixelXDimension / PixelYDimension を更新可能な範囲で更新
- Exif本体のその他フィールドは保持

既存の `jpeg-exif.js` を再利用 / 拡張する。

### 12.3 埋め込みサムネイル

Exif / JFIF 内の埋め込みJPEG thumbnailは初期実装では変換しない。

これは原版JTrimでも、ロスレス回転後にExplorer等で旧方向のサムネイルが見える事例が報告されている。

Web版では処理完了時に必要に応じて:

> Exif内の埋め込みサムネイルは回転前のままの場合があります。

と表示する。

将来フェーズでthumbnail JPEGも再帰的に係数変換できる。

## 13. ファイル更新の安全性

File System Access モードでは:

1. 現在FileHandleから最新 File を取得
2. `sourceSnapshot` と fingerprint 比較
3. 外部変更があれば中止 / 確認
4. 変換結果をメモリ上で最後まで生成
5. JPEG構造を検証
6. 新Blobを decode できることを確認
7. `createWritable()`
8. write
9. close
10. 再読込

「変換途中で元ファイルを部分的に書き換える」実装にはしない。

Web File System Access の writable は close 前に処理を完了する方式を利用し、失敗時は元ファイルを可能な限り保持する。

File input モードでは元ファイルを書き換えず Save As / download のみ。

## 14. JPEG Progressive / Sequential

### 14.1 UI

原版に合わせ、イメージメニューにチェック項目:

```text
☑ インターレース / プログレッシブ
```

Command:

```text
image.toggleInterlace
shortcut: Ctrl+I
```

これはドキュメント画素を変更しない **保存設定**。

設定は localStorage に保存する。

### 14.2 JPEG保存

設定 OFF:
- Sequential / baseline-compatible JPEG

設定 ON:
- Progressive JPEG

### 14.3 編集済みCanvas

Canvas RGBA を JPEG WASM encoder へ渡す。

設定:

```js
{
  quality,
  progressive,
  subsampling: "auto",
  optimizeHuffman: progressive
}
```

`auto` のサブサンプリング:

1. 元JPEGがあり、samplingが解析できている → 元samplingを優先
2. それ以外のカラー画像 → 4:2:0
3. グレースケール → grayscale

Sequential時は baseline-compatible な量子化表を使う。

### 14.4 未編集JPEGのSave As最適化

元JPEGから画素変更がなく、品質変更も要求されていない場合:

```text
JPEG source
  -> coefficient transcode
  -> progressive ON/OFF
```

とし、DCT再量子化を避ける。

ただしユーザーが品質値や目標ファイルサイズを変更して保存する場合は通常の再エンコードを行う。

## 15. JPEG目標ファイルサイズとの統合

現在の二分探索を Advanced JPEG encoder にも適用する。

```text
quality midpoint
  -> WASM JPEG encode(progressive flag)
  -> Exif inject
  -> blob.size
  -> next midpoint
```

Exif込みサイズを判定する現仕様を維持する。

Progressive ON/OFF によってサイズが変わるため、各候補は実際の最終モードでエンコードする。

## 16. Progressive変換だけを行う場合

既存JPEGを「画像内容を変えずに Progressive にする / Sequential に戻す」場合は coefficient transcode を使用できる。

これは JPEGロスレス回転と同じ Codec API の operation none + progressive flag で処理する。

将来的に JPEG品質ダイアログへ:

```text
[現在: Baseline]
[プログレッシブ形式へロスレス変換]
```

を追加可能。

ただし初期実装では原版同様、保存設定としての Ctrl+I を優先する。

## 17. PNG Interlaced

### 17.1 UI

同じ `image.toggleInterlace` を使用。

保存形式がPNGの場合:

- OFF → non-interlaced
- ON → Adam7

### 17.2 エンコード

```text
Canvas RGBA8
   |
   v
PNG WASM
   |
   +-- IHDR interlace_method = 0 or 1
   +-- filter selection
   +-- zlib compression
   |
   v
PNG Blob
```

Interlaced ON のときだけ WASM 必須。

OFF の通常PNGは当面 Canvas native encoder を維持する。

### 17.3 Alpha

RGBA8 をそのまま渡す。
現在のフルカラー透過を維持する。

パレットPNGへの自動変換はこのフェーズには含めない。

## 18. 一括変換

Batch options に追加:

```text
☐ インターレース / プログレッシブ
```

- JPEG出力 → Progressive
- PNG出力 → Adam7
- WebP → 無効 / hidden

1ファイルずつ Codec Worker へ渡し、現在の逐次処理・直接フォルダ出力を維持する。

## 19. Document metadata 拡張

```js
document: {
  ...,

  sourceFile,
  fileHandle,

  jpegInfo: {
    progressive,
    sampling,
    ...
  },

  jpegSourceState: {
    pristine: true,
    // source compressed bytes and current Canvas represent same image state
  }
}
```

Canvasを変更する操作がcommitされたら:

```text
jpegSourceState.pristine = false
```

Undoで元状態まで戻っても初期実装では自動trueへ戻さない。

理由:
Canvas履歴と圧縮元JPEGの同一性を厳密に追跡するより、安全に「再エンコードが必要」と判定する方が良い。

ファイル再読込 / 保存完了時に pristine=true。

## 20. Codec API

### JPEG transform

```js
jpegTransform(sourceBytes, {
  operation:
    "none" |
    "rotate90" |
    "rotate180" |
    "rotate270" |
    "flipH" |
    "flipV" |
    "transpose" |
    "transverse",

  perfect: true,
  trim: false,
  progressive: "preserve" | true | false,
  copyMarkers: true
})
```

戻り値:

```js
{
  bytes,
  width,
  height,
  progressive,
  trimmed: false,
  sourceSampling,
  mcuWidth,
  mcuHeight
}
```

### JPEG encode

```js
jpegEncode(rgba, width, height, {
  quality: 92,
  progressive: false,
  subsampling: "420"
})
```

### PNG encode

```js
pngEncode(rgba, width, height, {
  interlaced: false,
  compressionLevel: 6
})
```

## 21. エラーモデル

Codec Worker は文字列だけでなく code を返す。

```text
JPEG_NOT_SUPPORTED
JPEG_NOT_PERFECT
JPEG_CORRUPT
JPEG_TOO_MANY_SCANS
JPEG_MEMORY_LIMIT
PNG_ENCODE_FAILED
CODEC_INIT_FAILED
CODEC_OUT_OF_MEMORY
```

UIはcodeに応じて日本語メッセージを出す。

例:

`JPEG_NOT_PERFECT`

> この画像は端のブロックまで完全にはロスレス回転できません。
> 端をトリミングして再実行することはできます。

## 22. セキュリティ

圧縮画像は信頼できない入力として扱う。

### JPEG

- progressive scan 数に上限を設定
- 最大画像寸法を既存上限と整合
- 圧縮入力サイズ上限を設定
- Worker内で処理
- malformed JPEG は error で停止
- arithmetic JPEG等の非一般的形式は無理に処理しない

初期値案:

```text
compressed input: 512 MiB
max dimension: 30,000 px
max total pixels: 180,000,000
progressive scans: 100
```

### WASM

- SharedArrayBuffer は前提にしない
- GitHub Pages で COOP / COEP を要求しない
- 入力 ArrayBuffer は Workerへ transfer
- 結果 ArrayBuffer も transfer

## 23. メモリ

### JPEG transform

DCT transform は Canvas展開を行わない。

```text
source compressed bytes
+ coefficient storage
+ destination compressed bytes
```

写真を Canvas RGBA にするより有利。

### JPEG / PNG encode

RGBA入力は最大:

```text
width × height × 4
```

に加えて WASM 側バッファが必要。

Advanced encode時は大画像でメモリ不足になり得るため、Workerがサイズを事前確認する。

## 24. WASMロード

初回のみ:

```text
Ctrl+I保存
JPEG lossless transform
Adam7 PNG保存
        |
        v
"高度なJPEG/PNGコーデックを読み込んでいます…"
```

ロード後は Worker 内にインスタンスをキャッシュ。

UI起動時にはロードしない。

## 25. フォールバック

WASMが読み込めなかった場合:

### 通常JPEG / PNG
現在の Canvas保存へフォールバック。

### Progressive JPEG
実行不可として明示。

> この環境ではProgressive JPEGエンコーダを読み込めませんでした。

Sequential JPEGへ勝手に変更して保存しない。

### Interlaced PNG
同様に実行不可。

### JPEG lossless transform
通常Canvas回転へ自動フォールバックしない。

理由:
「ロスレス」と表示した機能が再圧縮を行うのは不可。

## 26. 原版との差

### 原版に近づける

- JPEG圧縮データに直接作用
- 未保存編集を破棄して元JPEGを変換
- コメント / Exifを維持
- 変換後に再読込
- Progressive / Interlacedを保存設定として扱う

### Web版で改善する

- partial iMCU を黙って変換せず perfect を既定
- 書込み前に外部変更をfingerprintで確認
- 完成した出力を検証してからFileHandleへ書込
- Orientationを画面上の見え方に合わせて正規化
- File inputモードでは元ファイルを直接変更しない

## 27. テスト設計

### 27.1 JPEG transform fixtures

少なくとも:

- 4:4:4
- 4:2:2
- 4:2:0
- grayscale
- MCU境界ぴったり
- partial iMCU
- Baseline
- Progressive
- Exif Orientation 1 / 3 / 6 / 8
- Exif / ICC / COM markerあり

操作:

- rotate90
- rotate180
- rotate270
- flipH
- flipV
- inverse transform

検証:

- サイズ
- SOF / sampling / DQT保持
- metadata
- Orientation=1
- perfect判定
- trim結果
- decode可能

### 27.2 DCTロスレス性

可能ならテスト用 wrapper に coefficient hash を用意する。

```text
source DCT
  -> transform
  -> inverse transform
  -> coefficient hash compare
```

quantization table と DCT coefficients が一致することを検証する。

ファイルバイト完全一致は entropy coding / marker ordering が変化し得るため要求しない。

### 27.3 Progressive

- OFF → SOF0 / sequential
- ON → SOF2 / progressive
- pixel decode結果が同品質設定で妥当
- coefficient transcodeでは量子化表が保持される

### 27.4 PNG

PNG IHDR:

```text
byte 28:
  0 = non-interlaced
  1 = Adam7
```

を検証。

両形式をdecodeして RGBA が元Canvasと完全一致することを確認。

### 27.5 Browser manual

Chrome / Edge / Firefox / Safari:

- lazy WASM load
- Save As
- FileHandle overwrite
- large image
- Worker failure
- offline/cache behavior

## 28. CI

通常CI:

- JS module syntax
- wrapper JS unit test
- fixture parser tests
- prebuilt WASMのSHA-256確認
- codec fixture smoke tests（NodeでWASMが動く場合）

WASM自体のフルビルドは通常CIで毎回行わず、依存更新用workflowを別にする。

```text
.github/workflows/
  ci.yml
  rebuild-codecs.yml  // manual dispatch
```

`rebuild-codecs.yml` は固定 upstream version から再現可能に生成し、成果物hashを出す。

## 29. 実装フェーズ

### CODEC-1 — Codec loader / Worker

- CodecClient
- codec-worker
- lazy WASM loader
- error model
- memory/input limits

完了条件:
WASMモジュールを必要時だけロードできる。

### CODEC-2 — JPEG lossless transform

- libjpeg-turbo wrapper
- rotate / flip
- perfect / trim
- marker copy
- Exif Orientation composition
- FileHandle safe write
- reload

完了条件:
JPEGを再量子化せず回転 / 反転できる。

### CODEC-3 — Progressive JPEG

- Canvas RGBA → JPEG WASM encode
- sequential / progressive
- target-size search integration
- Exif injection
- batch integration
- Ctrl+I

完了条件:
保存JPEGのSOF markerでProgressive ON/OFFを確認できる。

### CODEC-4 — Interlaced PNG

- libspng wrapper
- RGBA8 encode
- Adam7
- Save / Batch integration
- Ctrl+I

完了条件:
IHDR interlace method 1のPNGを生成し、decode後RGBAが一致する。

### CODEC-5 — Optimization / compatibility

- pristine JPEG coefficient transcode optimization
- source subsampling preservation
- large image stress test
- browser manual test
- offline/cache
- third-party notices

## 30. 実装順

推奨:

```text
CODEC-1
   ↓
CODEC-2 JPEG lossless
   ↓
CODEC-3 Progressive JPEG
   ↓
CODEC-4 Adam7 PNG
   ↓
CODEC-5 integration / optimization
```

理由:

- JPEG lossless transformが今回の最重要かつ最も仕様が厳しい
- libjpeg-turbo WASMを先に安定させればProgressive JPEGにも流用できる
- PNGはJPEGとは別WASMなので後から独立追加できる

## 31. Definition of Done

### JPEG lossless

- Canvas再エンコードを一切使用しない
- DCT coefficient transformである
- 90 / 180 / 270 / H / Vが動作
- perfect不可を検出する
- metadataを保持する
- Orientationを正しく処理する
- FileHandleの場合は安全に上書きし再読込する
- 未保存Canvas編集を明示確認して破棄する

### Progressive JPEG

- UIのON/OFFと実ファイルSOF形式が一致
- edited CanvasもProgressive保存可能
- target size / Exif / batchと統合

### Interlaced PNG

- ONでIHDR interlace=1
- OFFで既存non-interlaced保存を維持
- RGBA / alphaを保持
- batchと統合

## 32. 参考仕様・資料

- JTrim 1.53c ヘルプ由来資料:
  - JPEGロスレス回転はディスク上JPEGを直接更新し、未保存加工を破棄、コメント・Exifを維持
  - Interlace / ProgressiveはJPEGとPNG保存に作用

- libjpeg-turbo:
  - jpegtran / TurboJPEG transform はDCT係数を並べ替えるため再圧縮劣化がない
  - partial iMCUには perfect / trim の考慮が必要
  - Progressive変換をサポート

- PNG:
  - interlace method 1 = Adam7
  - 7-pass interlace

- Canvas `toBlob()`:
  - MIME type と quality は指定できる
  - progressive / interlace の指定APIはない

## 33. 設計判断

今回の設計では以下を採用する。

1. **JPEGロスレスをJSで自作しない。libjpeg-turbo WASMを使う。**
2. **partial iMCUはperfectを既定にし、黙って端帯を残さない。**
3. **Exif Orientationを変換の幾何として正しく合成し、出力はOrientation=1へ正規化する。**
4. **Progressive JPEGはAdvanced JPEG encoderで実装する。**
5. **Interlaced PNGはlibspng WASM + Adam7で実装する。**
6. **通常保存はNative Canvas encoderのままにし、WASMをlazy-loadする。**
7. **「ロスレス」機能はWASM失敗時に通常回転へ自動フォールバックしない。**
8. **FileHandleへの書込は完成済みBlobを検証してから行う。**
