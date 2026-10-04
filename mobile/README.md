# スタッフアプリ(iPhone・Android)

本番のスタッフアプリ(https://saas-erp-se-n.vercel.app/staff )を、スマホのアプリとして開くためのプロジェクトです。[Capacitor](https://capacitorjs.com/) で作っています。

- 中身(画面)は本番のシステムをそのまま表示するので、**システムを直すとアプリにもすぐ反映されます**(アプリを作り直す必要はありません)
- アプリを作り直すのは、アイコン・名前・カメラなどの権限を変えるときだけです
- ネットにつながらないときは「インターネットにつながりません」の画面を出します(`www/offline.html`)

## Android で試す(いちばん早い方法)

1. GitHub のこのリポジトリで「Actions」→「スタッフアプリ(スマホ)」を開く
2. いちばん新しい実行(緑のチェック)を開き、下の「Artifacts」から **staff-app-android** をダウンロード
3. zip を開いて出てくる `app-debug.apk` をスマホに送る(メール・Googleドライブなど)
4. スマホで `app-debug.apk` を開いてインストール(「提供元不明のアプリ」を許可する案内が出たら許可)

※ 手動で作り直したいときは、「Actions」→「スタッフアプリ(スマホ)」→「Run workflow」を押します。

## Google Play で公開する

1. [Google Play Console](https://play.google.com/console) で開発者アカウントを作る(登録料 25ドル・1回だけ)
2. アップロード用の鍵(キーストア)を作り、なくさないように保管する
   `keytool -genkey -v -keystore staff-app.jks -keyalg RSA -keysize 2048 -validity 10000 -alias staff-app`
3. Android Studio で `android` フォルダを開き、「Build → Generate Signed App Bundle」で `.aab` を作る(上の鍵を使う)
4. Play Console でアプリを作り、まず「内部テスト」に `.aab` を上げてスタッフに試してもらう
5. ストアの説明・スクリーンショット・プライバシーポリシーのURL(`https://saas-erp-se-n.vercel.app/privacy`)を入れて公開

社内のスタッフだけに配るなら、公開せずに「内部テスト」や「限定公開」のままでも使えます。

## iPhone(App Store)に出す

**Mac は要りません。** 手順は [APP_STORE.md](./APP_STORE.md) にまとめています(Apple Developer Program への登録 → App Store Connect でアプリ作成 → API キーを GitHub に登録 → ボタン1つでビルド・アップロード → TestFlight で確認 → 審査へ提出)。

- アップロード: GitHub の「Actions」→「iOS: App Store Connect にアップロード」(`.github/workflows/ios-release.yml`)
- ストア用のスクリーンショット(6.9インチ・1320×2868)と、説明文・キーワード・プライバシーの答え・審査メモの下書き: `store/` と APP_STORE.md
- iPhone 専用・縦向き専用にしています(iPad のスクリーンショット・審査が要らないように)

## 設定を変えるとき

`capacitor.config.json` を直して `npx cap sync` を実行します。

| 項目 | 今の値 | 説明 |
| --- | --- | --- |
| `appId` | `com.saaserp.staffapp` | アプリの識別子。ストアに初めて出す前に、会社のドメインを逆にした形(例: `jp.co.会社名.staff`)に変えてください。出したあとは変えられません |
| `appName` | スタッフアプリ | ホーム画面に出る名前 |
| `server.url` | 本番の `/staff` | アプリを開いたときに表示する画面。本番のURLが変わったらここと `allowNavigation` を直す |

アイコン・起動画面を変えるときは、`assets/` の画像(アイコン 1024×1024、起動画面 2732×2732)を差し替えて `npm run icons` を実行します。

## 中身

- `capacitor.config.json` … アプリの設定(表示するURL・名前など)
- `www/` … ネットにつながらないときの画面
- `android/` … Android のプロジェクト(Android Studio で開ける)
- `ios/` … iPhone のプロジェクト(Xcode で開ける。Swift Package Manager を使うので CocoaPods は不要)
- `assets/` … アイコン・起動画面の元画像
- `store/screenshots/` … App Store 用のスクリーンショット
- `ios/ExportOptions.plist` … App Store Connect へ送るときの設定
- `.github/workflows/mobile.yml`(リポジトリの一番上)… GitHub で Android の APK を作り、iPhone 用もビルドできるか確かめる
- `.github/workflows/ios-release.yml` … iPhone 用に署名して App Store Connect(TestFlight)へ送る
