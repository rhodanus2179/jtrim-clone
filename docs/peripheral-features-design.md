# 周辺機能ミニ設計 — Exif / 一括変換 / サムネイル / スライドショー

更新日: 2026-09-26

## 1. Exif保持

JPEG読込時に APP1/Exif セグメントを抽出し、Document metadata に保持する。

保存時:
1. CanvasでJPEGを再エンコード
2. 元画像のExif APP1をコピー
3. Orientationを1へ正規化
4. 画像サイズタグを現在のCanvasサイズへ更新可能な範囲で更新
5. 新JPEGへAPP1を再挿入

理由:
ブラウザのデコーダがExif Orientationを適用した後の画素をCanvasへ描画するため、元のOrientationをそのまま戻すと二重回転になる可能性がある。

JPEG目標サイズ保存では、Exif挿入後のBlobサイズを判定対象とする。

## 2. 一括変換

複数ファイルを同時にメモリ展開せず、1ファイルずつ順次処理する。

初期パイプライン:
- 出力形式 PNG / JPEG / WebP
- JPEG/WebP品質
- Exif保持（JPEG）
- リサイズ（幅・高さ、縦横比保持、7方式）
- グレースケール
- 明るさ / コントラスト

処理:
```
File[]
  -> decode one
  -> pipeline
  -> encode
  -> ZIP entry
  -> release bitmap/canvas
  -> next
```

結果は無圧縮ZIP（store方式）1ファイルとしてダウンロードする。
画像自体が既に圧縮済みなのでZIP側でDeflateしなくても実用上の不利は小さく、外部ライブラリも不要。

## 3. サムネイル

ユーザーが選んだ複数画像をブラウザ内ギャラリーとして保持する。

- Object URLを使い、画像本体を一括decodeしない
- lazy loading
- クリック: エディタで開く
- ファイル一覧を差し替える際にObject URLをrevoke

ブラウザから任意フォルダを無断走査できないため、原版のフォルダ型サムネイルは「複数ファイル選択」で代替する。

## 4. スライドショー

サムネイルと同じGallery FileListを共有する。

- 前 / 次
- 自動再生
- 2 / 3 / 5 / 10秒
- ファイル名表示
- ArrowLeft / ArrowRight
- Space: 再生 / 停止

画像はObject URLで表示し、編集Canvasへはdecodeしない。

## 5. メモリ方針

- Gallery: Object URLのみ
- Batch: 1ファイルずつdecode
- ZIP: 出力Blobバイトのみ蓄積
- Exif: 通常数十KB程度のUint8Array
