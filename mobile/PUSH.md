# 通知(プッシュ通知)の設定

スタッフアプリ(iPhone・Android)に通知を送るための設定です。★はアカウントの持ち主にしかできない作業です。
設定しなくてもアプリもシステムも普通に使えます。そのときは通知が届かないだけです。

## どんなときに通知が届くか

| できごと | 届く人 | タップすると開く画面 |
| --- | --- | --- |
| シフトを入れた・変えた・消した(シフト管理) | そのスタッフ | シフト(決まったシフト) |
| 前の週のシフトを写した・シフト希望からシフトを作った | シフトが入ったスタッフ(何日分入ったか) | シフト(決まったシフト) |
| 新しいマニュアルを公開した(下書きから公開にしたときも) | 会社のメンバー全員(書いた人を除く) | そのマニュアル |
| 公開中のマニュアルを直して「更新をスタッフのスマホに通知する」にチェック | 会社のメンバー全員(書いた人を除く) | そのマニュアル |
| 社内のお知らせを書いた | 会社のメンバー全員(書いた人を除く) | 社内のお知らせ |
| 申請(有給・稟議など)が承認・却下された | 申請した人 | 申請 |

- スタッフがアプリを開くと「通知を受け取りますか?」と聞きます。「その他」→「通知」からも、受け取る設定・ためしの通知ができます
- 通知が届くのは、シフト管理のスタッフと**ログインのアカウントをひも付けた人**だけです(シフトの通知)
- ログアウトすると、その端末には届かなくなります

---

## iPhone(APNs)

### 1. ★ 通知用の鍵(.p8)を作る(5分)

1. https://developer.apple.com/account/resources/authkeys/list を開く(Apple Developer Program の登録が必要です。手順は [APP_STORE.md](./APP_STORE.md))
2. 「+」→ 名前に `push` などと入れ、**Apple Push Notifications service (APNs)** にチェック →「Continue」→「Register」
   - 「Configure」で環境を聞かれたら **Sandbox & Production** を選ぶ
3. **Key ID**(英数字10文字)を控え、`AuthKey_XXXXXXXXXX.p8` をダウンロード(**ダウンロードは1回だけ**。なくさないように保管)
4. チームID(英数字10文字)は https://developer.apple.com/account の「メンバーシップの詳細」にあります

※ App Store Connect の API キー(アップロード用)とは別のものです。

### 2. ★ Vercel に登録する

Vercel のプロジェクト →「Settings」→「Environment Variables」で、次を登録して、もう一度デプロイ(Deployments →「Redeploy」)します。

| Name | 入れるもの |
| --- | --- |
| `APNS_KEY_ID` | 1-3 の Key ID |
| `APNS_TEAM_ID` | チームID |
| `APNS_KEY` | `.p8` ファイルをメモ帳などで開いた中身(`-----BEGIN PRIVATE KEY-----` から `-----END PRIVATE KEY-----` まで全部) |
| `APNS_BUNDLE_ID` | 省略可。アプリのバンドルIDを変えたときだけ(今は `com.saaserp.staffapp`) |
| `APNS_ENV` | 省略可。Xcode から直接 iPhone に入れて試すときだけ `development`(TestFlight・App Store のアプリは入れない) |

### 3. アプリを作り直す

通知を受け取れるようにしたアプリ(このバージョン以降)が必要です。GitHub →「Actions」→「iOS: App Store Connect にアップロード」→「Run workflow」で作り直して、TestFlight で入れ直してください。
アプリの「通知(Push Notifications)」の機能は、アップロードのときに自動でオンになります。

うまくいかないとき(「Push Notifications capability」などのエラー): https://developer.apple.com/account/resources/identifiers/list で `com.saaserp.staffapp` を開き、「Push Notifications」にチェックして保存してから、もう一度「Run workflow」を押してください。

---

## Android(Firebase Cloud Messaging)

Android の通知は Google の Firebase(無料)を使います。

### 1. ★ Firebase のプロジェクトを作る(10分)

1. https://console.firebase.google.com を開き、Google アカウントでログイン →「プロジェクトを作成」(名前は自由。Google アナリティクスはオフで構いません)
2. プロジェクトの画面で Android のアイコン(「アプリを追加」)を押す
3. **Android パッケージ名** に `com.saaserp.staffapp` と入れて「アプリを登録」
4. **google-services.json** をダウンロード(次の「2」で使います。ほかの手順は「次へ」で飛ばして構いません)

### 2. ★ GitHub に登録する(アプリ側)

GitHub のこのリポジトリ →「Settings」→「Secrets and variables」→「Actions」→「New repository secret」

| Name | 入れるもの |
| --- | --- |
| `GOOGLE_SERVICES_JSON` | `google-services.json` をメモ帳などで開いた中身(全部) |

登録したら、「Actions」→「スタッフアプリ(スマホ)」→「Run workflow」で Android のアプリを作り直し、スタッフのスマホに入れ直します。
(この登録がないと、通知なしのアプリが作られます。アプリの「その他」→「通知」に「通知の設定なしで作られています」と出ます)

### 3. ★ Vercel に登録する(サーバー側)

1. Firebase のプロジェクトの画面で、左上の歯車 →「プロジェクトの設定」→「サービス アカウント」
2. 「新しい秘密鍵を生成」→「キーを生成」で JSON ファイルをダウンロード(**人に渡さない・GitHub に入れない**)
3. Vercel →「Settings」→「Environment Variables」に登録して、もう一度デプロイ

| Name | 入れるもの |
| --- | --- |
| `FCM_SERVICE_ACCOUNT` | 2 の JSON ファイルの中身(`{` から `}` まで全部) |

---

## 確かめる

1. スタッフアプリでログインし、「通知を受け取る」を押して許可する
2. 「その他」→「通知」に「✓ この端末で通知を受け取ります」と出ていることを確かめる
3. 「ためしに通知を送る」を押して、数秒で届けば完了です

| 表示 | 対応 |
| --- | --- |
| まだサーバー側の通知の設定がされていません | Vercel の環境変数を確かめて、Redeploy |
| 通知がオフになっています | スマホの「設定」→「スタッフアプリ」→「通知」をオン |
| 送れませんでした(BadDeviceToken など) | iPhone: `APNS_ENV` を入れていないか確かめる(TestFlight のアプリは入れない) |
| 送れませんでした(SENDER_ID_MISMATCH など) | Android: `GOOGLE_SERVICES_JSON` と `FCM_SERVICE_ACCOUNT` が同じ Firebase プロジェクトのものか確かめる |
