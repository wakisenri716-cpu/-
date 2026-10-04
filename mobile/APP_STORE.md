# App Store に出す手順

スタッフアプリ(iPhone)を App Store に出すまでの手順です。**Mac は要りません**(GitHub がアプリを作って Apple に送ります)。
上から順に進めてください。★はあなた(アカウントの持ち主)にしかできない作業です。

---

## 1. ★ Apple Developer Program に登録する(1〜2日)

1. https://developer.apple.com/programs/enroll/ を開き、Apple ID でサインイン
2. 登録の種類を選ぶ
   - **個人**: すぐ登録できます。App Store の「販売元」にあなたの名前が出ます
   - **法人(会社)**: App Store に会社名が出ます。**D-U-N-S 番号**(無料・取得に数日〜2週間)が必要です
3. 年会費(99ドル。日本の価格は登録画面で確認)を払う
4. 登録が終わったら、https://developer.apple.com/account の「メンバーシップの詳細」にある **チームID**(英数字10文字)を控える

## 2. ★ App Store Connect でアプリを作る(10分)

1. https://appstoreconnect.apple.com →「アプリ」→「+」→「新規App」
2. 次のように入れる
   - プラットフォーム: iOS
   - 名前: App Store に出す名前(**他のアプリと同じ名前は使えません**。例:「〇〇 スタッフ」「〇〇 シフト・マニュアル」など、サービス名や会社名を入れると通りやすい)
   - 主言語: 日本語
   - バンドルID: `com.saaserp.staffapp`(一覧にないときは、下の「4」のアップロードを1回すると出てきます。会社のドメインで作りたいときは先に教えてください。`capacitor.config.json` などを変えます)
   - SKU: `staffapp`(自由な英数字)
   - ユーザアクセス: アクセス制限なし

## 3. ★ App Store Connect API キーを作り、GitHub に登録する(10分)

GitHub が、あなたの代わりにアプリに署名して Apple に送るための「鍵」です。

1. App Store Connect →「ユーザとアクセス」→「統合」→「App Store Connect API」→「チームキー」→「+」
2. 名前: `GitHub`、アクセス: **App Manager**(うまくいかないときは Admin)で作る
3. **キーID** と、画面上の **Issuer ID(発行者ID)** を控え、`AuthKey_XXXXXXXX.p8` をダウンロード(**ダウンロードは1回だけ**。なくさないように保管)
4. GitHub のこのリポジトリ →「Settings」→「Secrets and variables」→「Actions」→「New repository secret」で、次の4つを登録

| Name | 入れるもの |
| --- | --- |
| `APPLE_TEAM_ID` | 1で控えたチームID |
| `APP_STORE_CONNECT_KEY_ID` | キーID |
| `APP_STORE_CONNECT_ISSUER_ID` | Issuer ID |
| `APP_STORE_CONNECT_KEY` | `.p8` ファイルをメモ帳などで開いた中身(`-----BEGIN PRIVATE KEY-----` から `-----END PRIVATE KEY-----` まで全部) |

## 4. アプリを作って Apple に送る(ボタン1つ・20〜40分)

1. GitHub →「Actions」→ 左の「**iOS: App Store Connect にアップロード**」→「Run workflow」→ 緑の「Run workflow」
2. 緑のチェックになったら、15〜30分ほどで App Store Connect の「TestFlight」タブにビルドが出てきます
3. 2回目からは、同じボタンを押すだけで新しいビルドが送られます(番号は自動で増えます)

※ 画面(システム)の変更はアプリを作り直さなくても反映されます。作り直すのは、アイコン・名前・権限を変えたときや、Apple に新しいバージョンを出すときだけです。

## 4-2. ★ 通知を使う(おすすめ・15分)

シフトが決まったときなどにスマホへ通知を送れます。審査でも「Web サイトを包んだだけ」と言われにくくなります。手順は [PUSH.md](./PUSH.md)(Apple の通知用の鍵を作って Vercel に登録)。

## 5. ★ TestFlight で自分の iPhone で試す(10分)

1. iPhone に「TestFlight」アプリ(無料)を入れる
2. App Store Connect →「TestFlight」→「内部テスト」にグループを作り、自分(とスタッフ)を追加
3. 届いた招待から入れて、ログイン・シフト提出・在庫・マニュアル・カメラ(経費精算のレシート)・通知(「その他」→「通知」→「ためしに通知を送る」)を試す

社内のスタッフに配るだけなら、**この TestFlight のままでも使えます**(内部テストは100人まで・ビルドは90日ごとに更新)。

## 6. ★ App Store の情報を入れて、審査に出す

App Store Connect のアプリのページで、次を入れます。下書きは「8」にあります。

- **スクリーンショット**: 「6.9インチ」の欄に `mobile/store/screenshots/` の5枚(1320×2868)をドラッグ
- **説明・キーワード・サポートURL・プライバシーポリシーURL**
- **App のプライバシー**(下の「8-4」の答え)
- **年齢制限**: すべて「なし」→ 4+
- **価格**: 無料
- **App Review に関する情報**: 審査用のテストアカウント(下の「7」)と、メモ(「8-5」)
- 「ビルド」で TestFlight に来たビルドを選び、「審査用に追加」→「審査へ提出」

審査はふつう1〜3日です。

## 7. ★ 審査用のテストアカウントを用意する

Apple の審査員がログインして試せるアカウントが必要です。本番のシステムで次を用意してください。

1. 「ユーザー管理」で、従業員の権限のアカウントを作る(例: `appreview@あなたの会社のドメイン`、パスワードは審査用に新しく)
2. 「シフト管理」でスタッフとして登録してアカウントとひも付け、何日かシフトを入れる
3. 「マニュアル」に1〜2本、「在庫管理」に商品を2〜3個登録しておく(審査員が中身を見られるように)

審査が終わったら、パスワードを変えるか利用停止にしてください。

## 8. 掲載情報の下書き(コピーして使えます)

### 8-1. 名前・サブタイトル

- 名前(30文字まで): `〇〇 スタッフ`(〇〇はサービス名・会社名)
- サブタイトル(30文字まで): `シフト提出・在庫・マニュアルをスマホで`

### 8-2. 説明(4,000文字まで)

```
お店や事業所で働くスタッフのための、業務アプリです。
シフトの希望出し、在庫の記録、マニュアルの確認、タイムカード、経費精算を、スマホひとつでできます。

■ シフト
・来月の「出られる日と時間」「休みたい日」をスマホで提出
・決まったシフトと、今日のシフトがすぐわかる

■ 在庫
・商品の在庫数をその場で確認(少ない商品・在庫切れが一目でわかる)
・使った数(出庫)や、数えた数(棚卸)をその場で記録

■ マニュアル
・写真つきの手順書をいつでも確認
・読んだら「読みました」。新しいマニュアルや更新もすぐわかる

■ 通知
・シフトが決まった・変わったとき、新しいマニュアルや社内のお知らせが出たとき、申請が承認されたときにお知らせ

■ そのほか
・タイムカード(出勤・退勤・休憩の打刻)
・経費精算(レシートをカメラで撮って申請)
・有給休暇などの申請、社内のお知らせ

※ ご利用には、お勤め先がこのサービスを契約し、管理者がアカウントを作成している必要があります。ログイン情報はお勤め先の管理者にお問い合わせください。
```

### 8-3. キーワード・URL・カテゴリ

- キーワード(100文字まで): `シフト,シフト提出,シフト管理,在庫,棚卸,マニュアル,タイムカード,勤怠,経費精算,スタッフ,アルバイト,店舗`
- サポートURL: `https://saas-erp-se-n.vercel.app/support`
- プライバシーポリシーURL: `https://saas-erp-se-n.vercel.app/privacy`
- カテゴリ: ビジネス(サブ: 仕事効率化)
- 著作権: `2026 あなたの名前または会社名`

### 8-4. App のプライバシー(質問への答え)

- データを収集しますか? → **はい**
- 収集するデータ(すべて「Appの機能」のため・**ユーザーに関連付けられる**・**トラッキングには使わない**)
  - 連絡先情報: **名前**、**メールアドレス**
  - ユーザコンテンツ: **写真またはビデオ**(レシート・マニュアルの写真)、**その他のユーザコンテンツ**(シフト希望・日報・申請など)
  - ID: **ユーザID**
- 「トラッキング」: **しない**(広告・他社への提供はありません)

### 8-5. 審査員へのメモ(App Review に関する情報 → メモ)

```
This app is the mobile client of a business SaaS (shift scheduling, inventory, manuals, timecard and expense reports) used by staff of companies that subscribe to the service. Accounts are created by each company's administrator; there is no sign-up inside the app.

Please sign in with the demo staff account below. After signing in you can:
- Home: see today's shift and upcoming shifts
- Shift tab: submit availability for next month (tap ◯ / ✕ for each day, then "提出する")
- Stock tab: record stock usage or a stock count
- Manual tab: read manuals with photos and tap "読みました"
- その他 > 経費精算: take a photo of a receipt with the camera
- その他 > 通知: allow notifications and tap "ためしに通知を送る" to receive a test push notification

Push notifications are sent when a manager publishes/changes the staff member's shift, publishes a new manual or announcement, or approves/rejects their request.

Camera / photo library access is used only to attach receipt photos and manual photos.
Support: https://saas-erp-se-n.vercel.app/support
```

## 9. 審査でよくある指摘と対応

| 指摘 | 対応 |
| --- | --- |
| 2.1 テストアカウントでログインできない | アカウント・パスワードを確かめて、メモを直して再提出 |
| 4.2 Web サイトをそのまま包んだだけ | 「このサービスを契約した会社のスタッフ向けの業務アプリで、シフト提出・在庫記録・カメラでのレシート撮影などスマホならではの使い方をする」と返信。通知機能(シフト確定・新しいマニュアルのお知らせ。[PUSH.md](./PUSH.md))を設定してから出すと通りやすくなります |
| 5.1.1 アカウント削除 | アプリ内で新規登録はできず、アカウントは会社の管理者が作成・削除する旨と、サポートページ(`/support`)で削除を依頼できる旨を返信 |
| 3.2 社内向けアプリ | 特定の1社専用ではなく、契約したどの会社のスタッフも使えるサービスである旨を返信。1社専用で配るなら「非表示(Unlisted)配信」や Apple Business Manager の「カスタムApp」を使います |

---

困ったときは、エラーの画面(GitHub Actions の赤い×を開いた画面や、Apple からのメール)をそのまま見せてください。
