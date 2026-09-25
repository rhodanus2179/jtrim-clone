# jtrim-clone

JTrim 1.53c の操作感と主要機能を、HTML + CSS + JavaScript で現代のブラウザ上に再実装するプロジェクトです。

- インストール不要
- GitHub Pages で配信
- 原則として画像処理はブラウザ内で完結
- JTrim の軽さ・単純さ・直接操作感を重視
- レイヤー型の高機能画像編集ソフトではなく「さっと画像を加工する道具」を目指す

## Status

現在は原版 JTrim 1.53c の仕様調査・機能棚卸し段階です。

詳細: [JTrim 1.53c 機能インベントリ](docs/jtrim-1.53c-feature-inventory.md)

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
