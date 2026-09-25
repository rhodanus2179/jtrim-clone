# 実装計画

更新日: 2026-09-26

この文書は `docs/architecture.md` の設計を実装タスクへ分解したもの。

## Milestone 1 — 動く土台

目標:
画像を開いて編集画面に表示し、保存できる GitHub Pages を作る。

- index.html
- app shell
- menu
- toolbar
- status bar
- workspace
- file open
- drag & drop
- PNG/JPEG save
- zoom
- document state
- command registry
- keyboard shortcuts
- GitHub Pages 配信

完了条件:
- PC ブラウザで画像を開ける
- ズームできる
- PNG/JPEGで保存できる
- メニューとショートカットが同じ command を呼ぶ

## Milestone 2 — 基本画像編集

- selection rectangle
- selection handles
- crop
- resize dialog
- Box
- Hermite
- Triangle
- Bell
- Mitchell
- BSpline
- Lanczos3
- rotate left/right
- mirror
- flip
- undo / redo
- history depth 16

完了条件:
JTrimの基本用途である「開く→切り抜く→縮小→保存」が成立する。

## Milestone 3 — 日常レタッチ

- brightness / contrast
- grayscale
- sepia
- negative
- gamma
- RGB adjustment
- HSV
- sharpen
- gaussian blur
- mosaic
- margin
- arbitrary rotation
- text tool

完了条件:
日常的なスクリーンショット・写真加工用途で JTrim の代替になる。

## Milestone 4 — 編集・合成

- copy
- paste
- cut
- erase
- flood fill
- composite paste
- composite
- join
- gradient
- shadow
- texture

## Milestone 5 — カラー機能完全化

- histogram
- normalize
- equalize
- posterize
- solarize
- threshold
- RGB swap
- XOR
- shadow/highlight
- red-eye
- color count
- color depth conversion
- dithering

## Milestone 6 — 加工機能完全化

- soften
- soft lens
- emboss
- edge enhance
- edge extract
- motion blur
- diffuse
- noise
- wave
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
- custom filter

## Milestone 7 — 周辺機能

- thumbnails
- slideshow
- batch conversion
- clipboard
- screen capture
- transparency color
- Exif preservation
- JPEG target-size save

## Milestone 8 — 互換性検証

- original JTrim output fixture collection
- pixel diff
- resampler validation
- filter validation
- parameter range verification

## Issue 切り出し方針

Issue は「機能単位」ではなく、レビュー可能な大きさにする。

例:

- App shell と menu
- Document state と command registry
- Canvas workspace
- Rectangular selection
- Crop
- Resize dialog
- Lanczos3 resampler
- Undo/Redo
- Brightness/Contrast dialog
- Text tool

各 Issue には以下を書く。

- JTrim 原版仕様
- Web版仕様
- UI
- acceptance criteria
- tests

## Definition of Done

各機能は最低限以下を満たす。

- UI から実行できる
- keyboard shortcut がある場合は動作する
- undo 可能
- selection 対応の有無が仕様どおり
- large image で UI freeze を極力起こさない
- cancel で元画像が変化しない
- tests または目視比較手順が存在する
