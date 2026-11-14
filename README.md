# スマートフォン連携

Windows の「スマートフォン連携」のように PC と Android をシームレスにつなぐシステム（Web アプリ + Android APK、Material 3 Expressive）。

- **Web（PC）**: https://smartphone-renkei.vercel.app
- **APK**: [Releases](https://github.com/orokichi/smartphone-renkei/releases/latest)

## 機能
| 機能 | 内容 |
|---|---|
| ペアリング | PC の QR をアプリでスキャン（またはコード入力）。以後は自動再接続 |
| ファイル共有 | ドラッグ&ドロップで PC→スマホ、アプリ/共有メニューからスマホ→PC（進捗は波形プログレス） |
| クリップボード同期 | 双方向。PCはタブに戻った時、スマホはアプリを開いた時に自動送信 |
| 通知ミラー | スマホの通知を PC に表示・デスクトップ通知・PC から消去 |
| メッセージ | SMS スレッド閲覧・PC から送信・受信通知 |
| 通話 | 通話履歴、ダイヤルパッドから PC 経由でスマホ発信 |
| 写真 | 最近の写真をサムネイル表示し、選んで PC に保存 |
| その他 | スマホを鳴らす（最大音量）、リンクをスマホで開く、端末情報（電池・回線・容量） |
| デザイン | M3 Expressive（シェイプモーフ、スプリングモーション、波形プログレス）、ダイナミックカラー（スマホの壁紙色を PC にも反映） |

## 仕組み
- 通信: PeerJS（WebRTC DataChannel、端末間で暗号化された P2P。シグナリングのみ PeerJS クラウド）
- Web: Vite + React + TypeScript、@material/material-color-utilities
- Android: Kotlin。WebView で Web アプリを表示し、`window.Android` ブリッジで通知リスナー・SMS・通話履歴・写真・クリップボード・ファイル保存などのネイティブ機能を提供。フォアグラウンドサービスで接続を維持

## ビルド
- Web: `main` への push で Vercel が自動デプロイ
- APK: `android/` 変更時に GitHub Actions が署名済み APK をビルドして Releases に公開
