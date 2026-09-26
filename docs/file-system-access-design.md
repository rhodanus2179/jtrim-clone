# File System Access 対応設計

## 実装状況（2026-09-26）

- FS-1 Adapter / Workspace 基盤: **実装済み**
- FS-2 フォルダ型サムネイル: **実装済み**
- FS-3 FileHandle付き編集 / Ctrl+S / Save As: **実装済み**
- FS-4 一括変換の直接出力: **実装済み**
- FS-5 永続Workspace（最近使ったフォルダ / 再接続）: **実装済み**
- FS-6 統合・追加機能: **実装済み**
  - フォルダのドラッグ＆ドロップ
  - 再帰一括変換
  - 出力先へのフォルダ構造保持
  - size / lastModified に加えファイル先頭・末尾サンプルのSHA-256 fingerprintによる外部更新検知

現行実装でも非対応ブラウザでは Legacy mode を維持する。

更新日: 2026-09-26  
対象: jtrim-clone v0.7.0 以降

## 1. 目的

JTrim のデスクトップアプリらしいファイル操作を、対応ブラウザでは File System Access API を使ってできるだけ自然に再現する。

実現したい操作:

- 「フォルダを開く」
- 選択したフォルダ内をサムネイル表示
- フォルダ内の画像をスライドショー
- フォルダ内ファイルを直接編集
- `Ctrl+S` で元ファイルへ上書き保存
- 「名前を付けて保存」で任意の場所へ保存
- 一括変換結果を ZIP ではなくフォルダへ直接出力
- 前回利用したフォルダを「最近使ったフォルダ」として復元
- 非対応ブラウザでは現在の File input / download / ZIP 方式を維持

File System Access API は追加機能として扱い、既存のファイル処理を置き換えない。

## 2. 設計原則

1. **Progressive Enhancement**
   - File System Access API が利用できる環境ではフォルダモードを有効化する。
   - 非対応環境では現在の複数ファイル選択方式をそのまま使用する。

2. **最小権限**
   - フォルダ閲覧時は原則 read 権限だけ取得する。
   - 上書き保存・一括直接出力など、実際に書き込みが必要になったユーザー操作時に readwrite 権限を要求する。

3. **既存の画像処理系を再利用**
   - File System Access は「ファイルの取得・保存方法」だけを担当する。
   - decode / worker / encode / Exif / batch pipeline は既存実装を流用する。

4. **フォルダ内容をサーバーへ送信しない**
   - 列挙・読込・変換・保存はブラウザ内だけで行う。

5. **破壊的操作を安全側に倒す**
   - 一括変換のデフォルト出力は新規サブフォルダ。
   - 既存ファイルの一括上書きはデフォルトにしない。
   - 外部変更を検出した場合は上書き前に確認する。

## 3. ブラウザ機能検出

File System Access API の存在を User-Agent で判定しない。

```js
const capabilities = {
  directoryPicker: typeof window.showDirectoryPicker === "function",
  openFilePicker: typeof window.showOpenFilePicker === "function",
  saveFilePicker: typeof window.showSaveFilePicker === "function",
  permissionQuery:
    typeof FileSystemHandle !== "undefined" &&
    typeof FileSystemHandle.prototype.queryPermission === "function",
  permissionRequest:
    typeof FileSystemHandle !== "undefined" &&
    typeof FileSystemHandle.prototype.requestPermission === "function"
};
```

`showDirectoryPicker()` は secure context とユーザー操作を必要とする。
GitHub Pages は HTTPS なので配信条件を満たす。

非対応の場合:

```text
フォルダを開く
   ↓
File System Access 対応?
   ├─ yes → DirectoryHandle モード
   └─ no  → 現行 File input モード
```

## 4. 用語

本設計では以下の用語を使う。

- **Workspace**: ユーザーが JTrim Web で開いた作業フォルダ
- **Workspace root**: `showDirectoryPicker()` で選択されたルートディレクトリ
- **Current directory**: 現在サムネイル表示している Workspace 内ディレクトリ
- **Document handle**: 編集中画像に対応する `FileSystemFileHandle`
- **Output directory**: 一括変換等の書き込み先 `FileSystemDirectoryHandle`
- **Legacy mode**: File input + download/ZIP を利用する現在の方式

## 5. 全体アーキテクチャ

```text
+------------------------------------------------------+
| UI                                                   |
| Open Folder / Thumbnail / Save / Batch / Slideshow   |
+-------------------------------+----------------------+
                                |
                                v
+------------------------------------------------------+
| Workspace Controller                                 |
| current directory / navigation / sorting / filters   |
+---------------+----------------+---------------------+
                |                |
                v                v
+------------------------+  +--------------------------+
| File System Adapter    |  | Recent Handle Store      |
| picker / enumerate     |  | IndexedDB                |
| permission / read      |  | directory handles        |
| write / save           |  | preferences              |
+-----------+------------+  +--------------------------+
            |
            v
+------------------------------------------------------+
| Existing File / Image Layer                          |
| decode -> engine/worker -> encode -> Exif             |
+------------------------------------------------------+
```

File System Access 固有処理を `main.js` に直接増やさず、Adapter を設ける。

## 6. 新規モジュール

### 6.1 `js/io/file-system-access.js`

責務:

- API capability 判定
- Directory picker
- Open file picker
- Save file picker
- 権限確認
- DirectoryHandle 列挙
- FileHandle から File を取得
- FileHandle へ Blob を保存
- ディレクトリ内にファイル・サブフォルダを作成
- handle 同一性判定

予定 API:

```js
export function getFileSystemCapabilities();

export async function pickWorkspaceDirectory({
  mode = "read",
  id = "jtrim-workspace",
  startIn
});

export async function pickOutputDirectory({
  id = "jtrim-output",
  startIn
});

export async function queryHandlePermission(handle, {
  write = false
});

export async function ensureHandlePermission(handle, {
  write = false,
  request = false
});

export async function listDirectory(directoryHandle, {
  includeFiles = true,
  includeDirectories = true
});

export async function getFileFromHandle(fileHandle);

export async function writeBlobToFileHandle(fileHandle, blob);

export async function createFileInDirectory(
  directoryHandle,
  name,
  blob,
  { overwrite = false }
);

export async function getOrCreateDirectory(
  parentHandle,
  name
);
```

### 6.2 `js/io/handle-store.js`

IndexedDB で DirectoryHandle / FileSystemHandle を保持する。

DB:

```text
jtrim-file-system
  version: 1

object stores:
  recent-directories
  preferences
```

RecentDirectory:

```js
{
  id: "uuid",
  name: "Pictures",
  handle: FileSystemDirectoryHandle,
  lastUsedAt: 1790412345678,
  preferredMode: "read",
  isDefaultWorkspace: false
}
```

保持件数は初期値 10 件程度。

保存するのは Handle と表示用情報だけとし、画像内容は IndexedDB に保存しない。

### 6.3 `js/workspace/workspace-controller.js`

Workspace の UI 非依存状態を担当。

```js
WorkspaceState = {
  mode: "directory-handle" | "legacy",
  rootHandle: null,
  currentHandle: null,

  // root から current まで。絶対パスではない。
  breadcrumbs: [],

  permission: {
    read: "granted" | "prompt" | "denied" | "unsupported",
    readwrite: "granted" | "prompt" | "denied" | "unsupported"
  },

  sort: {
    field: "name" | "date" | "size" | "type",
    direction: "asc" | "desc"
  },

  filter: {
    query: "",
    imageOnly: true
  }
}
```

## 7. Document の拡張

現在の Document metadata に File System 情報を追加する。

```js
document: {
  fileName,
  sourceFormat,
  width,
  height,
  modified,
  exifSegment,

  // File System Access
  fileHandle: null,
  parentDirectoryHandle: null,
  workspaceRelativePath: null,

  sourceSnapshot: {
    size: null,
    lastModified: null
  }
}
```

`FileSystemHandle` 自体は JSON 化しない。

将来的に AppState を永続化する場合も、Handle は handle-store 側で管理する。

## 8. フォルダを開く

### 8.1 基本フロー

```text
[フォルダを開く]
       |
       v
showDirectoryPicker({ mode: "read" })
       |
       v
DirectoryHandle
       |
       +----> IndexedDB に recent handle 保存
       |
       v
Workspace root に設定
       |
       v
現在フォルダを列挙
       |
       v
サムネイル表示
```

Picker は必ずユーザー操作を起点に呼ぶ。

### 8.2 Picker options

```js
await window.showDirectoryPicker({
  id: "jtrim-workspace",
  mode: "read",
  startIn: previousHandle ?? "pictures"
});
```

`id` を固定し、ブラウザが直前の開始位置を再利用できる場合は利用する。

### 8.3 読み取り権限

フォルダを開いた直後は read のみ。

理由:

- サムネイル・スライドショー・編集開始に write は不要
- 不要な書き込み権限を要求しない
- ユーザーに「フォルダ全体を書き換えられる」と感じさせにくい

上書き保存や直接出力の操作時にだけ write を要求する。

## 9. 権限状態

権限は永続するとは仮定しない。

状態:

```text
unsupported
    |
no handle
    |
handle restored
    |
queryPermission
    |
    +---- granted ------> use
    |
    +---- prompt --------> 「再接続」表示
    |
    +---- denied --------> legacy / choose again
```

重要:

- 起動直後に自動で `requestPermission()` を呼ばない。
- `prompt` の場合は「再接続」ボタンを表示する。
- ユーザーがそのボタンを押したときに `requestPermission()` を呼ぶ。
- 書き込み権限も Save / Batch output 等の明示操作から要求する。

共通処理:

```js
async function ensureHandlePermission(handle, { write, request }) {
  const options = { mode: write ? "readwrite" : "read" };

  const current = await handle.queryPermission(options);
  if (current === "granted") return true;

  if (!request) return false;

  return (await handle.requestPermission(options)) === "granted";
}
```

実ブラウザでは API 有無も確認する。

## 10. 最近使ったフォルダ

`FileSystemDirectoryHandle` は IndexedDB に保存可能なため、最近開いた Workspace を保持する。

UI案:

```text
ファイル
├─ フォルダを開く...
├─ 最近使ったフォルダ
│   ├─ Pictures
│   ├─ 2026_旅行
│   └─ ...
└─ 最近使ったフォルダを消去
```

起動時:

1. IndexedDB から recent handles を読む
2. 権限を query する
3. granted → 直接利用可能
4. prompt → 「再接続が必要」
5. denied → 「アクセスなし」

自動的な権限ダイアログは出さない。

## 11. ディレクトリ列挙

### 11.1 デフォルト

現在フォルダの直下だけを列挙する。

```js
for await (const entry of directoryHandle.values()) {
  // entry.kind === "file" | "directory"
}
```

再帰走査は通常サムネイルでは行わない。

### 11.2 DirectoryEntry モデル

```js
{
  kind: "file" | "directory",
  name,
  handle,

  // getFile() を実行した時点で入る
  size: null,
  lastModified: null,
  mimeType: null,

  thumbnailUrl: null
}
```

最初から全ファイルを `getFile()` しない。

### 11.3 サムネイルの lazy load

`IntersectionObserver` を使う。

```text
DirectoryHandle
    ↓
entry.name / entry.kind の一覧だけ生成
    ↓
画面に近づく
    ↓
fileHandle.getFile()
    ↓
URL.createObjectURL(file)
    ↓
<img>
    ↓
画面離脱 / folder change
    ↓
URL.revokeObjectURL()
```

これにより数千ファイルのフォルダでも全画像を一括 decode しない。

## 12. フォルダナビゲーション

絶対ファイルシステムパスは取得・表示しない。

表示:

```text
Pictures / 2026 / 旅行 / 東京
```

これは Workspace root からの内部 breadcrumb。

実装:

```js
breadcrumbs = [
  { name: "Pictures", handle: root },
  { name: "2026", handle: dir2026 },
  { name: "旅行", handle: trip },
  { name: "東京", handle: tokyo }
]
```

上位へ戻る場合は breadcrumb に保持した handle を利用する。

## 13. サムネイル画面

フォルダモード時:

```text
┌─────────────────────────────────────────────┐
│ Pictures / 2026 / Photos             [更新] │
│ 🔎 [             ]  並び順 [名前▼]          │
├─────────────────────────────────────────────┤
│ 📁 subdir                                   │
│                                             │
│ [thumb]   [thumb]   [thumb]   [thumb]       │
│ IMG001     IMG002    IMG003    IMG004        │
│                                             │
└─────────────────────────────────────────────┘
```

操作:

- フォルダをダブルクリック → 移動
- 画像をクリック → 選択
- 画像をダブルクリック → 編集
- Enter → 編集
- F5相当 / 更新ボタン → 再列挙
- 並び順
  - 名前
  - 更新日時
  - サイズ
  - 種類
- 昇順 / 降順
- フィルタ文字列
- 「画像のみ」デフォルトON

## 14. ファイルを開く

Workspace から開く場合:

```text
FileSystemFileHandle
      ↓
handle.getFile()
      ↓
既存 decodeFileToCanvas()
      ↓
Document metadata
      + fileHandle
      + parentDirectoryHandle
      + sourceSnapshot
```

`sourceSnapshot`:

```js
{
  size: file.size,
  lastModified: file.lastModified
}
```

画像処理エンジンは Handle の存在を意識しない。

## 15. Ctrl+S 上書き保存

### 15.1 コマンド

現在:

`file.save` = ダウンロード中心

将来:

- `file.overwrite`: Ctrl+S
- `file.saveAs`: Ctrl+Shift+A

に分離する。

### 15.2 overwrite flow

```text
Ctrl+S
  |
  +-- document.fileHandle ?
        |
        no --> Save As
        |
        yes
        v
  queryPermission(readwrite)
        |
  granted?
     |       \
    yes      no
     |        |
     |    requestPermission(readwrite)
     |        |
     +--------+
        |
        v
 external change check
        |
        v
 encode current document
        |
        v
 handle.createWritable()
        |
 writable.write(blob)
        |
 writable.close()
        |
        v
 modified = false
 sourceSnapshot更新
```

### 15.3 外部変更検出

上書き直前に:

```js
const latest = await fileHandle.getFile();

const changedExternally =
  latest.lastModified !== document.sourceSnapshot.lastModified ||
  latest.size !== document.sourceSnapshot.size;
```

変更されていれば:

> このファイルはJTrim Webで開いた後に変更されています。上書きしますか？

を表示。

これは完全な競合検出ではないが、一般的な外部更新を検出できる。

### 15.4 保存フォーマット

元ファイルが:

- JPEG → JPEG
- PNG → PNG
- WebP → WebP

ならその形式で上書き。

ブラウザが保存できない入力形式や不明形式の場合は Save As にフォールバックする。

JPEGでは既存の Exif 保持処理を利用する。

## 16. 名前を付けて保存

対応ブラウザ:

`showSaveFilePicker()`

を利用する。

```text
名前を付けて保存
      ↓
showSaveFilePicker()
      ↓
FileSystemFileHandle
      ↓
encode
      ↓
createWritable/write/close
      ↓
Document.fileHandle を新Handleへ更新
```

非対応:

現在の Blob download を維持する。

Save As 後は新しい FileHandle を Document にセットし、その後の Ctrl+S は新しいファイルへ上書きする。

## 17. 一括変換 — 直接出力

現在:

```text
File[] -> conversion -> Blob[] -> ZIP
```

拡張:

```text
Workspace
   ↓
Input handles
   ↓
1 file at a time
   ↓
conversion pipeline
   ↓
Output DirectoryHandle
   ↓
write
```

### 17.1 出力モード

UI:

```text
出力先:
  ○ ZIPで保存（互換モード）
  ○ 入力フォルダ内の新規サブフォルダ
      [converted      ]
  ○ 出力フォルダを選択...
```

デフォルト:

**入力フォルダ内の `converted` サブフォルダ**

とする。

元ファイルを誤って上書きしないため。

### 17.2 既存ファイルポリシー

```text
同名ファイルがある場合:
  ○ 連番を付ける（デフォルト）
  ○ スキップ
  ○ 上書き
```

上書きの場合のみ明示的な readwrite 権限と確認を要求する。

### 17.3 サブフォルダ

初期実装:

- 現在フォルダのみ

次段階:

- 「サブフォルダも含む」
- 「フォルダ構造を出力先にも保持」

出力先が入力フォルダ内の場合は、出力ディレクトリ自身を再帰対象から除外する。

### 17.4 メモリ

直接出力時:

```text
decode 1 file
 -> process
 -> encode Blob
 -> write
 -> Blob参照破棄
 -> next
```

ZIPモードよりメモリ効率が良い。

## 18. スライドショー

Workspace モードでは FileList を作り直さず、DirectoryEntry 一覧を使う。

開始時点で対象画像の順序だけを snapshot する。

```js
slideEntries = visibleEntries
  .filter(isImage)
  .sort(currentSort)
  .map(entry => entry.handle);
```

表示時:

`fileHandle.getFile() -> Object URL`

前の画像の Object URL は次画像表示後に revoke する。

全画像を同時に decode しない。

## 19. ファイル更新の検知

初期実装では File System Observer に依存しない。

更新ボタン、ファイルを開く直前、上書き直前に `getFile()` を呼び直す。

将来:

- File System Observer が十分に普及した場合は optional enhancement
- 現時点の必須機能にはしない

## 20. ドラッグ＆ドロップ

既存の File drag/drop は維持。

対応ブラウザでは追加で:

```js
DataTransferItem.getAsFileSystemHandle()
```

が利用できる場合、

- フォルダをドロップ → Workspaceとして開く
- ファイルをドロップ → FileHandle付きで開く

を optional enhancement とする。

実装優先度は低め。

## 21. 権限・エラーUX

ユーザー向けメッセージを統一する。

### read permission が prompt

> このフォルダへのアクセスを再許可してください。

ボタン:

`[再接続]`

### write permission が必要

> 上書き保存するには、このファイルへの書き込みを許可してください。

ボタン:

`[書き込みを許可]`

### denied

> このフォルダへのアクセス権がありません。フォルダを選び直すか、従来のファイル選択を使用してください。

### unsupported

> このブラウザではフォルダ直接アクセスを利用できません。複数ファイル選択モードを使用します。

## 22. セキュリティ

- Picker / permission request は明示的なユーザー操作からのみ行う
- 起動時に勝手に権限要求しない
- read 権限から開始する
- write は必要になったときのみ昇格する
- 一括上書きはデフォルトにしない
- フォルダ外へのアクセスを推測・試行しない
- 画像内容を IndexedDB に永続化しない
- 画像・ファイル名を外部サービスへ送信しない
- 最近使ったフォルダはユーザー操作で削除可能にする

## 23. プライバシー上の表示

絶対ローカルパスは API から取得しない。

UIには Workspace 内の相対階層だけを表示する。

例:

```text
Pictures / Holiday / Tokyo
```

Webアプリ側が `C:\Users\...\Pictures` のようなOS上の絶対パスを知っているような表示はしない。

## 24. 既存コードへの影響

### 変更する

- `js/main.js`
  - File commands を Adapter 呼出へ変更
- Document metadata
  - FileHandle / sourceSnapshot 追加
- Thumbnail / Slideshow
  - FileList と WorkspaceEntry の両方を扱えるよう抽象化
- Batch
  - ZIP writer と Directory writer を切替可能にする

### 原則変更しない

- image worker
- pixel engine
- resampler
- filters
- undo/redo
- selection
- Exif parser/encoder
- Canvas renderer

したがって大規模なアーキテクチャ変更は不要。

## 25. フォールバック設計

機能ごとの対応:

| 機能 | File System Access モード | Legacy モード |
|---|---|---|
| 画像を開く | FileHandle / DirectoryHandle | input[type=file] |
| フォルダ表示 | DirectoryHandle | 複数ファイル選択 |
| Ctrl+S | 元FileHandleへ上書き | Save As / download |
| Save As | showSaveFilePicker | download |
| 一括変換 | Directoryへ直接保存 | ZIP download |
| サムネイル | フォルダ列挙 | FileList |
| スライドショー | フォルダ列挙 | FileList |
| 最近のフォルダ | IndexedDB Handle | なし |

Legacy モードを削除しない。

## 26. テスト戦略

### Unit

- capability detection
- 拡張子 / MIME 判定
- 出力ファイル名
- conflict policy
- sourceSnapshot comparison
- breadcrumb state
- sort / filter

### Mock Adapter test

ブラウザ実ファイルシステムへ依存せず、

```js
FakeDirectoryHandle
FakeFileHandle
FakeWritable
```

を作り、

- read
- enumerate
- write
- permission
- conflict

を検証する。

### Manual browser test

Chrome / Edge で:

1. Folder picker
2. permission restore
3. reopen after reload
4. write permission upgrade
5. Ctrl+S
6. external file modification warning
7. batch direct output
8. revoke permission
9. denied fallback

### Legacy regression

File System Access 非対応状態を feature flag で強制し、

- File input
- download
- ZIP batch
- thumbnails
- slideshow

が従来どおり動くことを確認する。

## 27. 実装フェーズ

### Phase FS-1 — Adapter / Workspace 基盤

- `file-system-access.js`
- capability detection
- showDirectoryPicker
- permission helper
- directory enumeration
- Workspace state
- 「フォルダを開く」

**完了条件:** 選択フォルダのファイル・サブフォルダを一覧表示できる。

### Phase FS-2 — フォルダ型サムネイル

- breadcrumb
- lazy thumbnails
- sort / filter
- folder navigation
- double click open

**完了条件:** JTrimのサムネイル画面に近い「フォルダブラウザ」として使える。

### Phase FS-3 — FileHandle付き編集 / Ctrl+S

- Document fileHandle
- sourceSnapshot
- readwrite permission upgrade
- overwrite save
- external-change check
- Save As with showSaveFilePicker

**完了条件:** フォルダから開いたJPEG/PNG/WebPを直接編集して Ctrl+S できる。

### Phase FS-4 — 一括変換の直接出力

- output directory
- converted subfolder
- conflict policy
- sequential write
- progress

**完了条件:** ZIPを介さず指定フォルダへ一括変換できる。

### Phase FS-5 — 永続Workspace

- IndexedDB handle store
- 最近使ったフォルダ
- permission state UI
- reconnect
- forget recent folders

**完了条件:** reload後に最近のフォルダを表示し、必要な場合だけ再許可を求められる。

### Phase FS-6 — 統合と追加機能

- Workspace slideshow
- directory drag/drop
- recursive batch
- preserve directory tree
- refresh / external changes

## 28. 実装順序

推奨:

```text
FS-1 Adapter
  ↓
FS-2 Folder thumbnails
  ↓
FS-3 Ctrl+S / Save As
  ↓
FS-4 Direct batch output
  ↓
FS-5 IndexedDB persistence
  ↓
FS-6 Recursive / DnD / refinements
```

理由:

- 最初に DirectoryHandle を UI へつなぐ
- 次に「開く→編集→保存」の最短ループを完成させる
- その後、一括変換を同じ Adapter に乗せる
- 永続化は基礎動作が安定してから追加する

## 29. 採用しない案

### File System Access 専用アプリにする

採用しない。

理由:
非対応ブラウザで既存機能まで失うため。

### 最初から readwrite で全フォルダを開く

採用しない。

理由:
閲覧だけでも強い権限を要求することになり、最小権限の原則に反する。

### HandleをlocalStorageにJSON保存する

採用しない。

理由:
FileSystemHandleは通常のJSON文字列として保存する対象ではない。
IndexedDBのstructured cloneを利用する。

### ファイル変更を常時ポーリングする

初期実装では採用しない。

理由:
大規模フォルダで無駄なI/Oが増える。
明示更新・open/save時の再取得で始める。

## 30. 外部仕様参照

- MDN: `showDirectoryPicker()`  
  https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker

- MDN: `FileSystemHandle.queryPermission()`  
  https://developer.mozilla.org/en-US/docs/Web/API/FileSystemHandle/queryPermission

- MDN: `FileSystemHandle.requestPermission()`  
  https://developer.mozilla.org/en-US/docs/Web/API/FileSystemHandle/requestPermission

- Chrome Developers: File System Access API  
  https://developer.chrome.com/docs/capabilities/browser-fs-access

- Chrome Developers: Persistent permissions for the File System Access API  
  https://developer.chrome.com/blog/persistent-permissions-for-the-file-system-access-api

## 31. 設計レビュー時に確認したい判断

特にレビューしてほしいのは以下の5点。

1. **フォルダを開く時点では read のみ**とし、保存時に write へ昇格する方針でよいか。
2. 一括変換の直接出力は、デフォルトを **`converted` サブフォルダ**としてよいか。
3. Ctrl+Sで外部変更を検出した場合、必ず確認ダイアログを出す方針でよいか。
4. 「最近使ったフォルダ」を最大10件、IndexedDBへHandleとして保存してよいか。
5. フォルダ型サムネイルの初期表示は **直下のみ**とし、再帰表示は一括変換オプションに限定してよいか。
