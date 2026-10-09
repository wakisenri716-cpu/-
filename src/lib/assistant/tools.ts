import type Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { findPartyInText, getKarte, templateSummary } from "@/lib/partyKarte";
import { listMemos, memoTitle } from "@/lib/phoneMemos";
import { MEMO_ACTIONS, type MemoAction } from "@/lib/phoneMemoLabels";
import { ruleCheck } from "@/lib/textCheck";
import { jstDateKey } from "@/lib/jst";
import { getIncomeStatement } from "@/lib/accounting/incomeStatement";
import { getAccountBalances } from "@/lib/accounting/ledger";
import { getAging } from "@/lib/accounting/receivables";
import { getJournalBook } from "@/lib/accounting/journal";
import { getSalesAnalysis } from "@/lib/accounting/salesAnalysis";
import { getBudgetProgress } from "@/lib/accounting/budgetProgress";
import { getCashBalance, getTodos } from "@/lib/dashboard";
import { getFiscalStartMonth, nextDay, resolvePeriod, toRange } from "@/lib/accounting/period";
import { proposeEndContract, proposeExpense, proposeFixAccount, proposeInvoice, proposeJournal, proposePoAction, proposeReminder, proposeVendorAccount } from "./proposals";
import { findAnomalies } from "@/lib/anomalies";
import { getCollections, STAGE_LABELS } from "@/lib/collections";
import { listContracts, CONTRACT_KINDS } from "@/lib/contracts";
import { buildCashFacts, riskOf } from "./cashAdvice";
import { runBookCheck } from "@/lib/bookCheck";
import { getMonthlyClose } from "@/lib/monthlyClose";
import { findMissingEntries, getCloseTasks } from "./closeAssistant";
import { getPoMatches } from "@/lib/poMatching";
import { findCustomerInsights, INSIGHT_LABELS } from "@/lib/customerInsights";
import { findVendorInsights, VENDOR_INSIGHT_LABELS } from "@/lib/vendorInsights";
import { getAccountReview, SOURCE_LABELS as ACCOUNT_SOURCE_LABELS } from "@/lib/accountReview";
import { getReceiptForecast, CONFIDENCE_LABELS } from "@/lib/receiptForecast";
import { getPaymentPlan, GROUP_LABELS } from "@/lib/paymentPlan";
import { getBillingGaps, GAP_LABELS } from "@/lib/billingGaps";
import { draftQuote } from "@/lib/quoteAssist";
import { getDuplicateParties } from "@/lib/partyMerge";
import { getYearEndChecklist } from "@/lib/yearEndClose";
import { findAndExplainJournal } from "@/lib/journalExplain";
import { runSimulation } from "@/lib/simulation";
import { getReorderSuggestions, reorderOptions } from "@/lib/reorder";
import { getBudgetVariance } from "@/lib/budgetVariance";
import { buildShiftDraft } from "@/lib/shiftDraft";
import { getPriceReview } from "@/lib/priceReview";
import { simulatePriceIncrease } from "@/lib/priceMath";
import { findFixedCosts } from "@/lib/fixedCosts";
import { getTaxForecast } from "@/lib/taxForecast";
import { SAVING_OPTIONS } from "@/lib/taxSavingOptions";
import { getLaborAnalysis } from "@/lib/laborAnalysis";
import { getCustomerProfit } from "@/lib/customerProfit";
import { getHrProcedures } from "@/lib/hrProcedures";
import { getTaxCalendar } from "@/lib/taxCalendar";
import { listMinutes } from "@/lib/minutes";
import { listTasks } from "@/lib/teamTasks";
import { draftScheduling } from "@/lib/scheduling";
import { slotLabel } from "@/lib/schedulingText";
import { holidaysOf, nextBusinessDay } from "@/lib/holidays";
import { closureMap, isCompanyOpen } from "@/lib/companyClosures";
import { defaultWeek, mondayOf, templateWeekly, weeklyFacts } from "@/lib/weeklyReport";
import { repeatLabel } from "@/lib/taskRepeat";
import { getEntertainment, KIND_LABEL } from "@/lib/entertainment";
import { getAnalysis } from "@/lib/accounting/analysis";
import { templateExplanation } from "@/lib/analysisExplain";
import { KIND_LABELS, hasCondition, parseSearch, runSearch } from "@/lib/globalSearch";

// AIアシスタントが使う道具。get_ の道具は会社のデータを読むだけ。propose_ の道具は下書きを作るだけで、
// 書き換えは利用者が画面で「実行する」を押したときだけ行う。
// 結果はAIが読む JSON 文字列(金額は円の整数)。

const PERIOD = {
  type: "object",
  properties: {
    preset: { type: "string", enum: ["this-month", "last-month", "this-fy", "last-fy", "all", "custom"], description: "期間。今月・先月・今期・前期・すべて・指定(from/to)" },
    from: { type: "string", description: "custom のときの開始日 YYYY-MM-DD" },
    to: { type: "string", description: "custom のときの終了日 YYYY-MM-DD" },
  },
  required: ["preset"],
  additionalProperties: false,
} as const;

export const ASSISTANT_TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "get_business_summary",
    description: "指定した期間の売上(収益)・費用・利益と、いまの現預金の残高を返す。「今月の利益は?」「今期の売上は?」などに使う。",
    input_schema: { ...PERIOD },
  },
  {
    name: "list_receivables",
    description: "入金待ちの売上請求書(売掛金)を返す。取引先ごとの合計と、期日を過ぎたものが分かる。customer で取引先名の一部を指定して絞り込める。",
    input_schema: { type: "object", properties: { customer: { type: "string", description: "顧客名の一部(任意)" } }, additionalProperties: false },
  },
  {
    name: "list_payables",
    description: "支払待ちの受け取った請求書(買掛金)を返す。取引先ごとの合計と、期日を過ぎたものが分かる。vendor で取引先名の一部を指定して絞り込める。",
    input_schema: { type: "object", properties: { vendor: { type: "string", description: "取引先名の一部(任意)" } }, additionalProperties: false },
  },
  {
    name: "search_journal",
    description: "仕訳を検索する。摘要のキーワード、勘定科目の名前、金額の範囲、期間で探せる。新しい順に最大30件。",
    input_schema: {
      type: "object",
      properties: {
        keyword: { type: "string", description: "摘要・メモに含まれる言葉(任意)" },
        account: { type: "string", description: "勘定科目の名前かコード(例: 地代家賃, 5060)(任意)" },
        minAmount: { type: "integer", description: "金額の下限(任意)" },
        maxAmount: { type: "integer", description: "金額の上限(任意)" },
        from: { type: "string", description: "開始日 YYYY-MM-DD(任意)" },
        to: { type: "string", description: "終了日 YYYY-MM-DD(任意)" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_account_balance",
    description: "勘定科目の残高を返す(資産・負債は指定日時点の残高、収益・費用は今期の累計)。科目の名前の一部かコードで指定する。",
    input_schema: {
      type: "object",
      properties: { account: { type: "string", description: "勘定科目の名前の一部かコード" }, asOf: { type: "string", description: "基準日 YYYY-MM-DD(任意。省略すると今日)" } },
      required: ["account"],
      additionalProperties: false,
    },
  },
  {
    name: "get_expense_breakdown",
    description: "指定した期間の費用を勘定科目ごとに多い順で返す。「何にお金を使っている?」などに使う。",
    input_schema: { ...PERIOD },
  },
  {
    name: "get_sales_by_customer",
    description: "指定した期間の顧客別の売上(税抜)とABCランク、品目別の売上、前年同期との比較を返す。",
    input_schema: { ...PERIOD },
  },
  {
    name: "get_budget_progress",
    description: "今期の予算に対する実績と着地見込み、予算を超えそうな科目を返す。",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "propose_invoice",
    description:
      "売上の請求書の下書きを作る(まだ確定しない)。利用者が画面で内容を確かめて「実行する」を押したときだけ発行される。単価は税抜の円。請求日を省略すると今日、支払期限を省略すると翌月末。",
    input_schema: {
      type: "object",
      properties: {
        customerName: { type: "string", description: "請求先(顧客)の名前" },
        issueDate: { type: "string", description: "請求日 YYYY-MM-DD(任意)" },
        dueDate: { type: "string", description: "支払期限 YYYY-MM-DD(任意)" },
        lines: {
          type: "array",
          description: "明細",
          items: {
            type: "object",
            properties: {
              description: { type: "string", description: "品目" },
              quantity: { type: "number", description: "数量(省略すると1)" },
              unit: { type: "string", description: "単位(任意)" },
              unitPrice: { type: "integer", description: "単価(税抜・円)" },
              taxRate: { type: "integer", enum: [10, 8], description: "税率(省略すると10)" },
            },
            required: ["description", "unitPrice"],
          },
        },
        notes: { type: "string", description: "備考(任意)" },
      },
      required: ["customerName", "lines"],
    },
  },
  {
    name: "propose_journal",
    description:
      "仕訳の下書きを作る(まだ記帳しない)。利用者が画面で内容を確かめて「実行する」を押したときだけ記帳される。借方と貸方の合計は同じにすること。勘定科目は名前かコードで指定する。",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "日付 YYYY-MM-DD(任意。省略すると今日)" },
        description: { type: "string", description: "摘要" },
        lines: {
          type: "array",
          description: "仕訳の行。1行は借方か貸方のどちらか一方だけに金額を入れる",
          items: {
            type: "object",
            properties: { account: { type: "string", description: "勘定科目の名前かコード" }, debit: { type: "integer" }, credit: { type: "integer" } },
            required: ["account"],
          },
        },
      },
      required: ["description", "lines"],
    },
  },
  {
    name: "propose_reminder",
    description:
      "支払期限を過ぎた請求書の督促メールの下書きを作る(まだ送らない)。利用者が「実行する」を押したときだけ、いつもの督促の文面で顧客に送られる。請求書番号か顧客名で指定する。",
    input_schema: { type: "object", properties: { invoice: { type: "string", description: "請求書番号か顧客名" } }, required: ["invoice"] },
  },
  {
    name: "propose_end_contract",
    description: "契約書の台帳で、契約を「終了」にする下書きを作る(まだ変えない)。解約した・更新しないと決めた契約に使う。契約の名前か相手の名前で指定する。相手への解約の連絡はしない。",
    input_schema: { type: "object", properties: { contract: { type: "string", description: "契約の名前か相手の名前" } }, required: ["contract"] },
  },
  {
    name: "propose_po_action",
    description:
      "発注書と受け取った請求書の突き合わせを片付ける下書きを作る(まだ変えない)。action=link: 合う発注書をこの請求書で検収済みにする。action=cancel: 発注書の検収ですでに計上したのに二重に取り込んだ請求書を取り消す。請求書番号・発注書番号・取引先名で指定する。先に get_po_matching で確かめること。",
    input_schema: {
      type: "object",
      properties: { invoice: { type: "string", description: "請求書番号・発注書番号・取引先名のどれか" }, action: { type: "string", enum: ["link", "cancel"] } },
      required: ["invoice", "action"],
    },
  },
  {
    name: "propose_vendor_account",
    description: "取引先(支払先)のいつもの勘定科目を決める下書きを作る(まだ変えない)。「〇〇はいつも通信費にして」などに使う。次からその取引先の経費・請求書をAIが読み取るときにこの科目を使う。経費の科目(旅費交通費・通信費・消耗品費・会議費・交際費・地代家賃・水道光熱費・広告宣伝費・支払手数料・雑費など)だけ指定できる。",
    input_schema: { type: "object", properties: { vendor: { type: "string", description: "取引先の名前" }, account: { type: "string", description: "勘定科目の名前かコード" } }, required: ["vendor", "account"] },
  },
  {
    name: "propose_expense",
    description: "利用者本人の経費精算(下書きの精算書)に経費を入れる下書きを作る(まだ入れない)。「昨日タクシー2,300円、取引先と打ち合わせのコーヒー1,200円」などに使う。日付は YYYY-MM-DD(省略すると今日)、金額は税込の円。",
    input_schema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              date: { type: "string", description: "日付 YYYY-MM-DD(任意)" },
              description: { type: "string", description: "内容(例: タクシー 新宿→渋谷)" },
              amount: { type: "integer", description: "金額(税込・円)" },
              account: { type: "string", description: "勘定科目の名前(例: 旅費交通費・会議費)" },
              vendorName: { type: "string", description: "支払先(任意)" },
            },
            required: ["description", "amount"],
          },
        },
      },
      required: ["items"],
    },
  },
  {
    name: "get_anomalies",
    description: "いつもと違うお金の動き(過去6か月と比べた費用の急増・売上の急減・いつもより大きい支払い・初めての取引先への大きな支払い)を返す。「何かおかしいところはある?」などに使う。",
    input_schema: { type: "object", properties: { month: { type: "string", description: "対象の月 YYYY-MM(任意。省略すると今月)" } }, additionalProperties: false },
  },
  {
    name: "get_collections",
    description: "支払期限を過ぎた未入金の請求書と、それぞれの督促の段階(1回目・2回目・電話・要相談・返事待ち)・督促した回数・その顧客のふだんの払い方を返す。「督促が必要なのは?」「回収が遅れている取引先は?」などに使う。",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_contracts",
    description: "契約書の台帳(相手・期間・自動更新・解約の申し出期限・月額)を返す。withinDays を指定すると、その日数以内に申し出期限か満了日が来る契約だけにする。「更新が近い契約は?」「毎月の固定の契約費は?」などに使う。",
    input_schema: { type: "object", properties: { withinDays: { type: "integer", description: "この日数以内に判断が必要なものだけ(任意)" } }, additionalProperties: false },
  },
  {
    name: "get_cash_outlook",
    description: "この先3か月の月末の現預金の見込み・最も低くなる月・資金が足りなくなる月・ふだんの毎月の支出・手元資金が何か月分か・危険の大きさ(LOW/MEDIUM/HIGH)を返す。「資金は大丈夫?」「お金が足りなくなる?」などに使う。",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_book_check",
    description: "今期の帳簿の点検結果(10万円以上の消耗品・大きい雑費・現金のマイナス・残った仮払金・私用に見える支出・二重計上の疑いなど)と点数を返す。「帳簿に問題はある?」「税理士に渡す前に直すところは?」などに使う。",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_close_status",
    description: "月次決算の進み具合(チェックリストの残り・まとめて実行できる作業・計上漏れかもしれない費用)を返す。「先月の締めは終わった?」「月次決算で残っていることは?」などに使う。",
    input_schema: { type: "object", properties: { month: { type: "string", description: "YYYY-MM(任意。省略すると先月)" } }, additionalProperties: false },
  },
  {
    name: "get_po_matching",
    description: "取り込んだ受け取った請求書と発注書の突き合わせ結果(金額が違う・二重計上の疑い・発注書なし)を返す。",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_customer_insights",
    description: "顧客ごとの変化(売上の減少・注文の途絶え・支払いが遅くなった・売上の偏り・大きな伸び)と次の一手を返す。「最近元気のない顧客は?」「売上が減っている取引先は?」などに使う。",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_vendor_insights",
    description: "仕入先・支払先ごとの変化(値上がり・支払いの急増・インボイス登録なしで控除できない消費税・登録の未確認・支払いの偏り・初めての大きな支払い)と次の一手を返す。「値上がりした仕入先は?」「インボイス登録のない取引先は?」などに使う。",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_account_review",
    description: "勘定科目が違いそうな経費の仕訳(摘要の言葉・取引先のいつもの科目・AIの見立てから)と、直す先の科目・理由を返す。「科目の間違いはある?」「雑費に入っているものを直したい」などに使う。直すときは lineId を propose_fix_account に渡す。",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "propose_fix_account",
    description: "get_account_review で見つかった仕訳を正しい科目へ振り替える下書きを作る(まだ記帳しない)。account を省略すると見直しの候補の科目にする。",
    input_schema: { type: "object", properties: { lineId: { type: "string" }, account: { type: "string", description: "直す先の勘定科目の名前かコード(任意)" } }, required: ["lineId"] },
  },
  {
    name: "get_receipt_forecast",
    description: "入金待ちの請求書が実際にはいつ入りそうか(顧客ごとの過去の払い方から見込んだ予測日・期日とのずれ・確からしさ・督促が必要か)と、月ごとの期日どおりと予測の入金額を返す。「来月いくら入金されそう?」「入金が遅れそうな取引先は?」などに使う。",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_payment_plan",
    description: "この先2週間に期限が来る支払い(受け取った請求書・期限切れを含む)を、いまの現預金と入金予測で払えるか確かめた支払計画(支払う/支払日をずらす相談・振込先の口座の有無・最も低くなる残高)を返す。「今週は何を払えばいい?」「支払いは大丈夫?」などに使う。",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_billing_gaps",
    description: "出し忘れているかもしれない請求(毎月請求している顧客に今月まだ請求していない・受注した商談なのに請求書がない・請求書にしていない見積)を返す。「請求漏れはない?」「今月請求を忘れている取引先は?」などに使う。",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "draft_quote",
    description: "見積書の明細の下書きを作る(見積書はまだ作らない)。過去の請求書・見積書の同じような品目の単価を参考にし、過去と大きく違う単価に目印を付ける。返った link を開くと、その明細が入った見積書の作成画面になる。text には見積の内容を、customerName には見積先を入れる。",
    input_schema: { type: "object", properties: { customerName: { type: "string" }, text: { type: "string", description: "見積の内容(品目・数量・単価など)" } }, required: ["text"] },
  },
  {
    name: "get_duplicate_parties",
    description: "同じ相手が2つ以上登録されているかもしれない仕入先・顧客の組(名前の表記ゆれ・似ている名前)と、それぞれの使われ方・AIの見立てを返す。「取引先がダブっていない?」などに使う。まとめるのは「取引先の重複」の画面で人が行う。",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_year_end",
    description: "決算の準備のチェックリスト(各月の締め・減価償却・棚卸・現金の実査・仮払金・未払/前払の計上・消費税の決算整理・法人税等・期末の締め)の済み/未と、期末までの日数・申告の期限を返す。「決算の準備は?」「決算までに何をすればいい?」などに使う。",
    input_schema: { type: "object", properties: { year: { type: "integer", description: "年度の開始年(任意)" } }, additionalProperties: false },
  },
  {
    name: "get_reorder",
    description: "発注の提案。在庫が早くなくなる商品(在庫・1日に使う量・もつ日数・発注中の数)と、発注する数の目安・前回の発注先と単価を返す。「何を発注すればいい?」「在庫が切れそうなのは?」などに使う。",
    input_schema: { type: "object", properties: { leadDays: { type: "integer", description: "納品までの日数(既定7)" }, coverDays: { type: "integer", description: "何日分を頼むか(既定30)" } }, additionalProperties: false },
  },
  {
    name: "get_budget_variance",
    description: "予算と実績の差の原因。予算を超えた・超えそうな費用と届かなそうな売上について、月の予算から外れた月・記帳のない月・前年の同じ時期より増えた/減った取引・一度に大きな支払いを返す。「なぜ予算を超えた?」「売上が予算に届かない理由は?」などに使う。",
    input_schema: { type: "object", properties: { year: { type: "integer", description: "年度の開始年(任意)" } }, additionalProperties: false },
  },
  {
    name: "get_shift_draft",
    description: "シフトの自動作成の下書き(保存しない)。スタッフのシフト希望と直近4週の曜日ごとの人数から、指定の月(既定は来月)のシフトの下書き件数・人が足りない日・スタッフごとの日数・人件費の見込みと売上に対する割合を返す。「来月のシフトを作って」「シフトは足りてる?」などに使う。作るのは画面で人が確かめてから。",
    input_schema: { type: "object", properties: { month: { type: "string", description: "YYYY-MM(任意)" } }, additionalProperties: false },
  },
  {
    name: "get_price_review",
    description: "値上げの検討。直近3か月の利益率と前の時期の比較、上がった費用、利益率を戻すのに必要な値上げの目安、品目ごとの売値と据え置き期間、値上げした場合の1か月の利益の増え方を返す。「値上げしたほうがいい?」「5%上げたらどうなる?」などに使う。",
    input_schema: { type: "object", properties: { raisePct: { type: "number", description: "値上げの割合(%、任意)" }, lossPct: { type: "number", description: "お客さまが減る割合(%、任意)" } }, additionalProperties: false },
  },
  {
    name: "get_fixed_costs",
    description: "固定費・サブスクの見直し。帳簿から毎月くり返している支払い(月と年間の金額・最近の金額・値上がり・同じ種類が複数・止まった支払い)と、毎月の支払いの合計・売上に対する割合を返す。「固定費を減らしたい」「サブスクは何がある?」などに使う。",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_tax_forecast",
    description: "今期の着地見込みと納税の目安。終わった月の実績と直近3か月の平均から期末の税引前利益を見込み、法人税等(標準税率の目安)・中間納付を引いた納付額・納付期限・いまの現預金と、決算までにできること(決算賞与・経営セーフティ共済・少額の備品・短期前払費用・処分)の一覧を返す。「今期の税金はいくら?」「節税は?」「決算対策は?」などに使う。税理士への確認を必ず勧める。",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_labor_analysis",
    description: "人件費の分析。直近6か月の売上・粗利・人件費・人件費率・労働分配率・勤務時間・人時売上高、指定の月(YYYY-MM、任意)のスタッフごとの勤務時間・残業(月45時間超の印)・深夜・支給額、曜日ごとの1時間あたりの売上を返す。「人件費は高い?」「残業が多い人は?」「何曜日が暇?」などに使う。",
    input_schema: { type: "object", properties: { month: { type: "string", description: "YYYY-MM(任意)" } }, additionalProperties: false },
  },
  {
    name: "get_customer_profit",
    description: "顧客別の採算。直近12か月の顧客ごとの売上(税抜)・案件に付いた原価と経費・日報の作業時間と人件費・粗利・粗利率・1時間あたりの粗利・入金の遅れと、赤字・粗利率が低い・手間のわりに粗利が少ない・入金が遅れがちの印を返す。「儲かっている顧客は?」「採算の悪い取引先は?」などに使う。",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_hr_procedures",
    description: "入社・退職の手続き。入社日・退職日が近いスタッフごとに、健康保険・厚生年金と雇用保険の資格取得届/喪失届、住民税の異動届、源泉徴収票、労働条件通知書、振込先の登録、備品の返却などを期限・済みかどうか付きで返す。「入社の手続きは?」「退職する人の届出は?」「離職票は?」などに使う。",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_tax_calendar",
    description: "税金・労務のカレンダー。これから12か月の申告・届出・納付の期限(源泉所得税・住民税・社会保険料の納付、算定基礎届、労働保険の年度更新、36協定、年末調整、法定調書・給与支払報告書、償却資産申告、決算と中間申告)を、済み・期限切れ・2週間以内の印つきで返す。「今月の税金の期限は?」「年度更新はいつ?」「次の申告は?」などに使う。",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_minutes",
    description: "議事録。新しい順に最大10件の会議(日付・名前・出席者・決まったこと・やること(担当・期限))を返す。「この前の会議で決まったことは?」「会議の宿題は?」「○○さんの担当は?」などに使う。",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_entertainment",
    description: "交際費の管理。今期の接待交際費の合計・1人1万円以下として除ける飲食費・1年のペース・損金の上限(中小法人は年800万円)と、明細(日付・内容・金額・種類・人数・相手・1人あたり・足りない記録)を返す。「交際費はあといくら使える?」「接待費は使いすぎ?」などに使う。",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_party_status",
    description: "取引先カルテ。名前で指定した顧客・仕入先の「いま」(直近12か月の取引額と前の12か月、最後の請求、入金待ち・支払予定、期限を過ぎた請求書、返事待ちの見積、進行中の商談、対応していない伝言、契約、最近のメモ)と、気をつけること・次にやること、最近のやりとり10件を返す。「さくら商事との取引はどうなってる?」「○○社に電話する前に状況を教えて」などに使う。",
    input_schema: { type: "object", properties: { name: { type: "string", description: "取引先・顧客の名前(一部でよい)" } }, required: ["name"], additionalProperties: false },
  },
  {
    name: "get_phone_memos",
    description: "伝言メモ(電話・来客)。対応していない伝言(相手・宛先・用件・折り返しの要否・至急・受けた日時)を、至急・新しい順に最大20件返す。「伝言はある?」「折り返しが必要な電話は?」などに使う。",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_tasks",
    description: "社内のやること(タスク)。まだ済んでいないやること(内容・担当・期限・取引先・繰り返し)を期限の近い順に最大30件と、期限を過ぎた件数・今日が期限の件数を返す。mine=true なら聞いた人が担当(と担当なし)のものだけ。「今日のやることは?」「田中さんのタスクは?」「期限切れのやることは?」などに使う。",
    input_schema: { type: "object", properties: { mine: { type: "boolean", description: "自分の担当だけ" }, owner: { type: "string", description: "担当の人の名前(一部でよい)" } }, additionalProperties: false },
  },
  {
    name: "get_weekly_report",
    description: "週報。1週間(月〜日)の済んだやること・日報の作業時間(人別・案件別)・請求書と入金・見積・受注・伝言、来週が期限のやること、期限を過ぎたやること・請求書をまとめた週報の本文と数字を返す。week を省くと、月〜水は先週・木〜日は今週。「今週はどうだった?」「先週の週報を作って」などに使う。",
    input_schema: { type: "object", properties: { week: { type: "string", description: "週のどこかの日 YYYY-MM-DD(任意)" } }, additionalProperties: false },
  },
  {
    name: "get_meeting_slots",
    description: "日程調整。取引先との打ち合わせの候補日時を、営業日(土日・祝日・年末年始を除く)から1日1つずつ出し、日程のご相談メールの下書きも返す。聞いた人のやることに打ち合わせ・訪問が入っている日は外す。「さくら商事との打ち合わせの候補を出して」「来週、1時間の打ち合わせの日程を3つ」などに使う。",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "相手の取引先・顧客の名前(任意)" },
        purpose: { type: "string", description: "用件(任意)" },
        minutes: { type: "number", description: "所要時間(分、既定60)" },
        count: { type: "number", description: "候補の数(1〜5、既定3)" },
        after: { type: "number", description: "何日後から(既定2)" },
        time: { type: "string", enum: ["am", "pm", "any"], description: "時間帯" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_business_calendar",
    description: "営業日と祝日。指定した月(既定は今月)の祝日(振替休日・国民の休日を含む)、会社の休業日(夏季休業など)、営業日の数(土日・祝日・年末年始・会社の休業日を除く)、今日の次の営業日を返す。「11月の祝日は?」「今月の営業日は何日?」「次の営業日は?」などに使う。",
    input_schema: { type: "object", properties: { month: { type: "string", description: "YYYY-MM(任意)" } }, additionalProperties: false },
  },
  {
    name: "check_text",
    description: "送る前の文章チェック(決まったルール)。渡した文章の、日付と曜日の食い違い・ありえない日付・二重敬語・「御中」と「様」の重ね・ら抜き言葉・同じ言葉の重なり・拝啓と敬具・金額の桁区切りなどを返す。「この文章をチェックして」「曜日は合ってる?」などに使う。",
    input_schema: { type: "object", properties: { text: { type: "string", description: "確かめる文章(8000文字まで)" } }, required: ["text"], additionalProperties: false },
  },
  {
    name: "get_business_analysis",
    description: "経営分析。期間(既定は今期の期首から今日まで)の売上・粗利・営業利益・現預金と、粗利率・営業利益率・人件費率・流動比率・当座比率・自己資本比率・手元資金(月商の何か月分)・売掛金の回収日数、前年同期の値、一般的な目安、良いところ・気をつけるところを返す。「会社の状態は?」「つぶれにくい?」「経営分析して」などに使う。",
    input_schema: { type: "object", properties: { from: { type: "string", description: "YYYY-MM-DD(任意)" }, to: { type: "string", description: "YYYY-MM-DD(任意)" } }, additionalProperties: false },
  },
  {
    name: "simulate_scenario",
    description:
      "もしもシミュレーション。「1人採用したら」「売上が10%減ったら」「200万円の設備を買ったら」「500万円借りたら」のとき、これから12か月の利益と現預金の見込みを、いまのままと比べて返す。条件が読み取れるなら revenuePct・items・oneTime を入れる(text だけでもよい)。",
    input_schema: {
      type: "object",
      properties: {
        text: { type: "string", description: "もしもの内容(文章)" },
        revenuePct: { type: "number", description: "売上の増減(%)。10%減なら -10" },
        items: { type: "array", description: "毎月の費用の増減(円/月、増えるなら正)。from は来月を1とした開始の月", items: { type: "object", properties: { label: { type: "string" }, monthly: { type: "integer" }, from: { type: "integer" } }, required: ["label", "monthly", "from"] } },
        oneTime: { type: "array", description: "一度だけの出入り(出るなら正、入るなら負)。借入など利益に関係しないものは cashOnly を true", items: { type: "object", properties: { label: { type: "string" }, amount: { type: "integer" }, month: { type: "integer" }, cashOnly: { type: "boolean" } }, required: ["label", "amount", "month"] } },
      },
      additionalProperties: false,
    },
  },
  {
    name: "search_data",
    description: "会社のデータ(請求書・見積書・発注書・仕訳・経費・契約書・取引先・書類)をまとめて探す。「先月のA社の請求書」「10万円以上の経費」「家賃の仕訳」のような文をそのまま query に入れると、期間・金額・種類・言葉を読み取って探す。",
    input_schema: { type: "object", properties: { query: { type: "string", description: "探したいものを書いた文" } }, required: ["query"], additionalProperties: false },
  },
  {
    name: "explain_journal",
    description: "仕訳1件が何の取引かを説明する(「この仕訳は何?」「3日の5万円の仕訳はなぜ前払費用?」など)。何が増えて何が減ったか、利益と現預金への影響、確かめた方がよい点を返す。摘要の言葉・日付・金額で探し、複数あれば候補を返すので entryId で選び直す。",
    input_schema: {
      type: "object",
      properties: {
        keyword: { type: "string", description: "摘要の一部(任意)" },
        date: { type: "string", description: "日付 YYYY-MM-DD(任意)" },
        amount: { type: "integer", description: "金額(円・任意)" },
        entryId: { type: "string", description: "候補から選んだ仕訳のID(任意)" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_todos",
    description: "いま会社でやるべきこと(レビュー待ち・承認待ち・期限切れの請求書・納付期限など)の一覧を返す。",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
];

type Input = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const DATE = /^\d{4}-\d{2}-\d{2}$/;

async function periodOf(companyId: string, input: Input) {
  const preset = str(input.preset) || "this-month";
  return resolvePeriod({ preset, from: str(input.from) || undefined, to: str(input.to) || undefined }, await getFiscalStartMonth(companyId));
}

async function findAccount(companyId: string, q: string) {
  const accounts = await prisma.account.findMany({ where: { companyId }, select: { id: true, code: true, name: true, category: true }, orderBy: { code: "asc" } });
  return accounts.find((a) => a.code === q) ?? accounts.find((a) => a.name === q) ?? accounts.find((a) => a.name.includes(q)) ?? null;
}

export async function runAssistantTool(ctx: { companyId: string; userId: string; source?: "ASSISTANT" | "MCP"; sourceName?: string }, name: string, input: Input): Promise<unknown> {
  const { companyId } = ctx;
  switch (name) {
    case "propose_invoice":
      return proposeInvoice(ctx, input);
    case "propose_journal":
      return proposeJournal(ctx, input);
    case "propose_reminder":
      return proposeReminder(ctx, input);
    case "propose_end_contract":
      return proposeEndContract(ctx, input);
    case "propose_po_action":
      return proposePoAction(ctx, input);
    case "propose_vendor_account":
      return proposeVendorAccount(ctx, input);
    case "propose_expense":
      return proposeExpense(ctx, input);
    case "propose_fix_account":
      return proposeFixAccount(ctx, input);
    case "get_receipt_forecast": {
      const f = await getReceiptForecast(companyId);
      return {
        total: f.total,
        laterThanDue: f.later,
        months: f.months,
        invoices: f.rows.slice(0, 30).map((r) => ({ customer: r.customer, invoice: r.invoiceNumber, remaining: r.remaining, dueDate: r.dueDate, predictedDate: r.predictedDate, shiftDays: r.shiftDays, confidence: CONFIDENCE_LABELS[r.confidence], needsReminder: r.risk, basis: r.basis, aiReason: r.aiReason })),
        aiSummary: f.review?.summary ?? null,
        screen: "/receipt-forecast",
      };
    }
    case "get_payment_plan": {
      const p = await getPaymentPlan(companyId);
      return {
        cashNow: p.cashNow,
        keepAtLeast: p.buffer,
        receiptsIn14Days: p.receipts,
        payTotal: p.payTotal,
        deferTotal: p.deferTotal,
        lowest: p.lowest,
        payments: p.rows.slice(0, 30).map((r) => ({ vendor: r.vendor, invoice: r.invoiceNumber, amount: r.remaining, dueDate: r.dueDate, payDate: r.payDate, group: GROUP_LABELS[r.group], action: r.action === "PAY" ? "支払う" : "ずらす相談", hasPayeeAccount: r.hasAccount, reason: r.reason, aiNote: r.aiNote })),
        later: p.later,
        screen: "/payment-plan",
      };
    }
    case "draft_quote": {
      const user = (ctx.userId && (await prisma.user.findUnique({ where: { id: ctx.userId }, select: { id: true, name: true } }))) || { id: ctx.userId, name: "AIアシスタント" };
      const d = await draftQuote({ ...user, companyId }, input);
      return { lines: d.lines.map((l) => ({ description: l.description, quantity: l.quantity, unit: l.unit, unitPrice: l.unitPrice, taxRate: l.taxRate, pastPrices: l.history ? `${l.history.min}〜${l.history.max}円(${l.history.count}件)` : null, warning: l.priceWarning })), subtotal: d.subtotal, link: `/quotes/new?draft=${d.draftId}`, note: "下書きです。リンクを開いて内容を確かめ、見積書を作ってください。" };
    }
    case "get_year_end": {
      const c = await getYearEndChecklist(companyId, input.year);
      return { fiscalYear: `${c.from}〜${c.to}`, ended: c.ended, daysToEnd: c.daysToEnd, filingDeadline: c.filingDeadline, left: c.left, total: c.total, items: c.items.map((i) => ({ label: i.label, done: i.done, detail: i.detail })), screen: "/year-end-close" };
    }
    case "get_duplicate_parties": {
      const r = await getDuplicateParties(companyId);
      return { count: r.groups.length, groups: r.groups.slice(0, 20).map((g) => ({ kind: g.kind === "vendor" ? "仕入先・支払先" : "顧客", strength: g.strength === "same" ? "同じ名前" : "似ている名前", names: g.parties.map((p) => p.name), aiSame: g.aiSame, aiNote: g.aiNote })), screen: "/party-duplicates" };
    }
    case "get_billing_gaps": {
      const r = await getBillingGaps(companyId);
      return { count: r.gaps.length, gaps: r.gaps.slice(0, 20).map((g) => ({ kind: GAP_LABELS[g.kind], level: g.level, customer: g.customer, title: g.title, detail: g.detail, amount: g.amount, href: g.href, aiNote: g.aiNote })), aiSummary: r.review?.summary ?? null, screen: "/billing-gaps" };
    }
    case "get_account_review": {
      const r = await getAccountReview(companyId);
      return {
        checked: r.checked,
        count: r.suggestions.length,
        suggestions: r.suggestions.slice(0, 20).map((x) => ({ lineId: x.lineId, date: x.date, description: x.description, vendor: x.vendorName, amount: x.amount, from: x.from.name, to: x.to.name, reason: x.reason, source: ACCOUNT_SOURCE_LABELS[x.source] })),
        aiSummary: r.review?.summary ?? null,
        screen: "/account-review",
      };
    }
    case "get_business_summary": {
      const period = await periodOf(companyId, input);
      const [is, cash] = await Promise.all([getIncomeStatement(companyId, toRange(period)), getCashBalance(companyId)]);
      return { period: period.label, revenue: is.totalRevenue, expense: is.totalExpense, profit: is.netIncome, cashBalanceNow: cash, link: "/income-statement" };
    }
    case "list_receivables":
    case "list_payables": {
      const issued = name === "list_receivables";
      const q = str(input[issued ? "customer" : "vendor"]);
      const aging = await getAging(companyId, issued ? "ISSUED" : "RECEIVED");
      const rows = aging.rows.filter((r) => !q || r.partyName.includes(q));
      return {
        today: aging.today,
        total: rows.reduce((s, r) => s + r.remaining, 0),
        overdueTotal: rows.filter((r) => r.overdueDays > 0).reduce((s, r) => s + r.remaining, 0),
        byParty: aging.parties.filter((p) => !q || p.name.includes(q)).slice(0, 20).map((p) => ({ name: p.name, remaining: p.total, invoices: p.count })),
        invoices: rows.slice(0, 30).map((r) => ({ number: r.invoiceNumber, party: r.partyName, dueDate: r.dueDate, remaining: r.remaining, overdueDays: r.overdueDays })),
        link: "/receivables",
      };
    }
    case "search_journal": {
      const account = str(input.account) ? await findAccount(companyId, str(input.account)) : null;
      const from = DATE.test(str(input.from)) ? str(input.from) : null;
      const to = DATE.test(str(input.to)) ? str(input.to) : null;
      const entries = await getJournalBook(companyId, {
        postedOnly: true,
        filter: {
          q: str(input.keyword) || undefined,
          accountId: account?.id,
          min: Number.isInteger(input.minAmount) ? (input.minAmount as number) : undefined,
          max: Number.isInteger(input.maxAmount) ? (input.maxAmount as number) : undefined,
        },
      });
      const inRange = entries.filter((e) => {
        const d = jstDateKey(e.date);
        return (!from || d >= from) && (!to || d <= to);
      });
      return {
        account: account ? `${account.code} ${account.name}` : null,
        count: inRange.length,
        entries: inRange.slice(0, 30).map((e) => ({
          date: jstDateKey(e.date),
          description: e.description,
          lines: e.lines.map((l) => ({ account: l.account.name, debit: l.debit, credit: l.credit })),
        })),
        link: "/journal",
      };
    }
    case "get_account_balance": {
      const account = await findAccount(companyId, str(input.account));
      if (!account) return { error: "その勘定科目が見つかりません" };
      const asOf = DATE.test(str(input.asOf)) ? str(input.asOf) : jstDateKey(new Date());
      const pl = account.category === "REVENUE" || account.category === "EXPENSE";
      const fy = pl ? resolvePeriod({ preset: "this-fy" }, await getFiscalStartMonth(companyId)) : null;
      const balances = await getAccountBalances(companyId, fy ? { ...toRange(fy), lt: nextDay(asOf) } : { lt: nextDay(asOf) });
      const b = balances.find((x) => x.account.id === account.id);
      return { account: `${account.code} ${account.name}`, basis: pl ? `今期(${fy!.from}〜${asOf})の累計` : `${asOf}時点の残高`, balance: b?.balance ?? 0, link: `/ledger?accountId=${account.id}` };
    }
    case "get_expense_breakdown": {
      const period = await periodOf(companyId, input);
      const is = await getIncomeStatement(companyId, toRange(period));
      return {
        period: period.label,
        total: is.totalExpense,
        accounts: [...is.expenseRows].sort((a, b) => b.balance - a.balance).slice(0, 15).map((r) => ({ account: r.account.name, amount: r.balance })),
        link: "/income-statement",
      };
    }
    case "get_sales_by_customer": {
      const period = await periodOf(companyId, input);
      const a = await getSalesAnalysis(companyId, period);
      return {
        period: period.label,
        total: a.total,
        priorYearSamePeriod: a.priorTotal,
        customers: a.customers.slice(0, 15).map((c) => ({ name: c.name, amount: c.amount, rank: c.rank, priorYear: c.prior })),
        lostCustomers: a.lost.slice(0, 10),
        items: a.items.slice(0, 10).map((i) => ({ name: i.name, amount: i.amount })),
        link: "/sales-analysis",
      };
    }
    case "get_budget_progress": {
      const p = await getBudgetProgress(companyId);
      const pick = (r: (typeof p.expense)[number]) => ({ account: r.name, budget: r.budget, actual: r.actual, forecast: r.forecast, status: r.status });
      return { year: p.year, elapsedMonths: p.elapsed, revenue: p.revenue.map(pick), expense: p.expense.map(pick), alerts: p.alerts, link: "/monthly/progress" };
    }
    case "get_anomalies": {
      const r = await findAnomalies(companyId, str(input.month) || null);
      return { month: r.month, anomalies: r.anomalies.map((a) => ({ title: a.title, detail: a.detail, amount: a.amount, link: a.href })), link: "/anomalies" };
    }
    case "get_collections": {
      const c = await getCollections(companyId);
      return {
        overdueTotal: c.total,
        invoices: c.rows.slice(0, 20).map((r) => ({
          customer: r.customer?.name ?? null,
          number: r.invoiceNumber,
          remaining: r.remaining,
          daysOverdue: r.daysOverdue,
          reminders: r.reminders,
          lastReminded: r.lastReminded,
          nextStep: `${STAGE_LABELS[r.stage].label}: ${STAGE_LABELS[r.stage].action}`,
          habit: r.habit,
        })),
        link: "/collections",
      };
    }
    case "get_contracts": {
      const within = Number.isInteger(input.withinDays) ? (input.withinDays as number) : null;
      const d = await listContracts(companyId);
      const active = d.contracts.filter((c) => c.status === "ACTIVE");
      const list = within === null ? active : active.filter((c) => { const n = c.daysToDeadline ?? c.daysToEnd; return n !== null && n >= 0 && n <= within; });
      return {
        monthlyTotal: d.monthlyTotal,
        contracts: list.slice(0, 30).map((c) => ({ title: c.title, counterparty: c.counterparty, kind: CONTRACT_KINDS[c.kind] ?? c.kind, endDate: c.nextEnd, autoRenew: c.autoRenew, noticeDeadline: c.deadline, daysToDeadline: c.daysToDeadline, amount: c.amount, amountPeriod: c.amountPeriod, keyPoints: c.keyPoints })),
        link: "/contracts",
      };
    }
    case "get_cash_outlook": {
      const f = await buildCashFacts(companyId);
      return { risk: riskOf(f), cashNow: f.cashNow, months: f.months, shortageMonth: f.shortageMonth, lowest: f.lowest, avgMonthlyExpense: f.avgMonthlyExpense, monthsOfCash: f.monthsOfCash, overdueReceivables: f.overdueReceivables.total, bigOutflows: f.bigOutflows, link: "/cashflow" };
    }
    case "get_book_check": {
      const r = await runBookCheck(companyId);
      return { period: r.periodLabel, score: r.score, findings: r.findings.map((f) => ({ level: f.level, title: f.title, detail: f.detail, link: f.href })), link: "/book-check" };
    }
    case "get_close_status": {
      const close = await getMonthlyClose(companyId, /^\d{4}-(0[1-9]|1[0-2])$/.test(str(input.month)) ? str(input.month) : undefined);
      const [tasks, missing] = await Promise.all([getCloseTasks(companyId, close.month), findMissingEntries(companyId, close.month)]);
      return {
        month: close.month,
        done: close.done,
        total: close.total,
        remaining: close.items.filter((i) => !i.done).map((i) => ({ item: i.label, detail: i.detail ?? null })),
        batchTasks: tasks.filter((t) => t.count > 0).map((t) => ({ task: t.label, count: t.count, amount: t.amount })),
        possiblyMissing: missing.slice(0, 8).map((m) => ({ account: m.account, usualAmount: m.typical })),
        link: `/monthly-close?month=${close.month}`,
      };
    }
    case "get_po_matching": {
      const rows = await getPoMatches(companyId);
      return { items: rows.slice(0, 20).map((r) => ({ kind: r.kind, vendor: r.vendor, invoice: r.invoice.number, invoiceTotal: r.invoice.total, order: r.order?.number ?? null, orderTotal: r.order?.total ?? null, message: r.message })), link: "/po-matching" };
    }
    case "get_customer_insights": {
      const r = await findCustomerInsights(companyId);
      return { customers: r.customers, insights: r.insights.map((i) => ({ customer: i.name, kind: INSIGHT_LABELS[i.kind], detail: i.detail, nextStep: i.action, link: `/vendors/customer/${i.customerId}` })), link: "/customer-insights" };
    }
    case "get_vendor_insights": {
      const r = await findVendorInsights(companyId);
      return { vendors: r.vendors, insights: r.insights.map((i) => ({ vendor: i.name, kind: VENDOR_INSIGHT_LABELS[i.kind], detail: i.detail, nextStep: i.action, link: `/vendors/vendor/${i.vendorId}` })), link: "/vendor-insights" };
    }
    case "get_reorder": {
      const r = await getReorderSuggestions(companyId, reorderOptions(input));
      return { needed: r.needed.map((x) => ({ name: x.name, onHand: `${x.onHand}${x.unit}`, dailyUse: x.dailyUse, daysLeft: x.daysLeft, onOrder: x.onOrder, suggested: `${x.suggested}${x.unit}`, unitPrice: x.unitPrice, vendor: x.vendorName, reasons: x.reasons })), checked: r.checked, link: "/reorder" };
    }
    case "get_budget_variance": {
      const r = await getBudgetVariance(companyId, input.year ? String(input.year) : null);
      return {
        year: r.year,
        elapsedMonths: r.elapsed,
        items: r.items.map((i) => ({
          account: i.name,
          kind: i.kind === "EXPENSE" ? "費用" : "売上",
          status: i.status,
          budget: i.budget,
          budgetSoFar: i.pace,
          actual: i.actual,
          forecast: i.forecast,
          findings: i.findings,
          drivers: i.drivers.slice(0, 3).map((d) => ({ label: d.label, current: d.current, previous: i.basis === "lastYear" ? d.previous : null, diff: i.basis === "lastYear" ? d.diff : null })),
        })),
        link: "/monthly/variance",
      };
    }
    case "get_shift_draft": {
      const r = await buildShiftDraft(companyId, { month: str(input.month) || undefined });
      return {
        month: r.month,
        draftShifts: r.draft.length,
        existingShifts: r.existingCount,
        shortages: r.shortages.map((s) => ({ date: s.date, weekday: s.weekday, missing: s.need - s.have })),
        staff: r.perStaff.map((p) => ({ name: p.name, availableDays: p.availableDays, draftDays: p.draftDays, totalDays: p.totalDays, submittedRequests: p.submitted > 0 })),
        laborCost: r.laborCost,
        laborCostRatio: r.ratio === null ? null : `${Math.round(r.ratio * 100)}%`,
        notes: r.notes,
        link: `/shifts/auto?month=${r.month}`,
      };
    }
    case "get_price_review": {
      const r = await getPriceReview(companyId);
      const raise = Number(input.raisePct ?? r.neededPct ?? 5) || 5;
      const loss = Number(input.lossPct ?? 0) || 0;
      return {
        period: r.period,
        marginBefore: r.margin.base,
        marginRecent: r.margin.recent,
        costUps: r.costUps.map((c) => ({ account: c.name, increasePerMonth: c.diff, pct: c.pct })),
        neededPricePct: r.neededPct,
        items: r.items.slice(0, 10).map((i) => ({ item: i.label, price: i.price, unchangedMonths: i.months, revenue12Months: i.revenue12 })),
        ifRaised: raise > 0 && raise <= 100 && loss >= 0 && loss <= 90 ? simulatePriceIncrease(r.monthly, raise, loss) : null,
        findings: r.findings,
        link: "/price-review",
      };
    }
    case "get_fixed_costs": {
      const r = await findFixedCosts(companyId);
      const active = r.items.filter((i) => i.status === "ACTIVE");
      return {
        monthlyTotal: r.monthlyTotal,
        yearlyTotal: r.yearlyTotal,
        count: active.length,
        ratioToRevenue: r.ratio === null ? null : `${Math.round(r.ratio * 1000) / 10}%`,
        items: active.slice(0, 20).map((i) => ({ name: i.label, account: i.accountName, monthly: i.monthly, yearly: i.yearly, lastAmount: i.lastAmount, flags: i.flags, note: i.note })),
        stopped: r.items.filter((i) => i.status === "STOPPED").map((i) => ({ name: i.label, lastMonth: i.lastMonth })),
        link: "/fixed-costs",
      };
    }
    case "get_tax_forecast": {
      const r = await getTaxForecast(companyId);
      return {
        fiscalYear: `${r.from}〜${r.to}`,
        remainingMonths: r.remaining,
        actualPretaxSoFar: r.actual.pretax,
        forecastPretax: r.ready ? r.forecast.pretax : null,
        taxEstimate: r.ready ? r.result.total : null,
        interimPaid: r.interim,
        payable: r.ready ? r.payable : null,
        deadline: r.deadline,
        cash: r.cash,
        findings: r.findings,
        options: SAVING_OPTIONS.map((o) => ({ title: o.title, detail: o.detail, caution: o.caution })),
        note: "標準税率での目安。実際の申告・節税は税理士に確認すること",
        link: "/tax-forecast",
      };
    }
    case "get_labor_analysis": {
      const r = await getLaborAnalysis(companyId, str(input.month) || null);
      return { months: r.months, staffMonth: r.month, staff: r.staff.map(({ staffId: _s, ...s }) => (void _s, s)), weekdays: r.weekdays, findings: r.findings, link: "/labor-analysis" };
    }
    case "get_customer_profit": {
      const r = await getCustomerProfit(companyId);
      return {
        period: `${r.from}〜${r.to}`,
        totalRevenue: r.totalRevenue,
        customers: r.rows.slice(0, 20).map((c) => ({ name: c.name, revenue: c.revenue, share: c.share, cost: c.cost + c.laborCost, hours: c.hours, gross: c.gross, margin: c.margin, grossPerHour: c.grossPerHour, avgLateDays: c.avgLateDays, overdue: c.overdue, flags: c.flags })),
        findings: r.findings,
        link: "/customer-profit",
      };
    }
    case "get_hr_procedures": {
      const r = await getHrProcedures(companyId);
      return {
        today: r.today,
        people: r.cases.map((c) => ({ name: c.name, kind: c.kind === "hire" ? "入社" : "退職", date: c.date, open: c.tasks.filter((t) => !t.done).map((t) => ({ task: t.label, due: t.due, dueNote: t.dueNote, status: t.status })) })),
        findings: r.findings,
        link: "/hr-procedures",
      };
    }
    case "get_tax_calendar": {
      const r = await getTaxCalendar(companyId);
      return {
        today: r.today,
        events: r.events.slice(0, 40).map((e) => ({ title: e.title, due: e.due, start: e.start, category: e.category, status: e.status, note: e.note })),
        findings: r.findings,
        link: "/tax-calendar",
      };
    }
    case "get_minutes": {
      const rows = (await listMinutes(companyId)).slice(0, 10);
      const today = jstDateKey(new Date());
      const actions = rows.flatMap((m) => m.content.actions.map((a) => ({ ...a, meeting: m.title })));
      const late = actions.filter((a) => a.due && a.due < today);
      const findings = rows.length
        ? [`最近の会議は「${rows[0].title}」(${rows[0].heldOn.replaceAll("-", "/")})です。${rows[0].content.decisions.length ? `決まったこと: ${rows[0].content.decisions.slice(0, 3).join("/")}` : ""}`, ...(late.length ? [`期限を過ぎたやることが${late.length}件あります: ${late.slice(0, 3).map((a) => `${a.task}${a.owner ? `(${a.owner})` : ""}`).join("、")}`] : [])]
        : ["まだ議事録はありません。"];
      return {
        meetings: rows.map((m) => ({ title: m.title, heldOn: m.heldOn, attendees: m.attendees, decisions: m.content.decisions, actions: m.content.actions, link: `/minutes/${m.id}` })),
        findings,
        link: "/minutes",
      };
    }
    case "get_entertainment": {
      const r = await getEntertainment(companyId);
      return {
        period: `${r.fy.from}〜${r.fy.to}`,
        used: r.used,
        excludableUnder10k: r.excludable,
        forecastYear: r.forecast,
        limit: r.limit,
        rows: r.rows.slice(-30).map((x) => ({ date: x.date, description: x.description, amount: x.amount, kind: KIND_LABEL[x.kind], persons: x.persons, guests: x.guests, perPerson: x.perPerson, missing: x.missing })),
        findings: r.findings,
        link: "/entertainment",
      };
    }
    case "get_party_status": {
      const found = await findPartyInText(companyId, str(input.name));
      if (!found.party) return { error: `「${str(input.name)}」という取引先・顧客は見つかりませんでした`, link: "/vendors" };
      const k = await getKarte(companyId, found.party.kind, found.party.id);
      const t = templateSummary(k.facts);
      return {
        party: found.party.name,
        kind: k.facts.kind,
        status: t.status,
        cautions: t.cautions,
        next: t.next,
        facts: k.facts,
        recent: k.events.slice(0, 10).map((e) => ({ date: e.at, type: e.type, title: e.title, detail: e.detail })),
        otherCandidates: found.candidates.slice(1),
        link: `/vendors/${found.party.kind}/${found.party.id}`,
      };
    }
    case "get_phone_memos": {
      const memos = (await listMemos(companyId, ctx.userId)).filter((m) => m.status === "OPEN").slice(0, 20);
      return {
        count: memos.length,
        urgent: memos.filter((m) => m.urgent).length,
        memos: memos.map((m) => ({ from: memoTitle(m), phone: m.callerPhone, for: m.forName ?? "どなたか", message: m.message, action: MEMO_ACTIONS[m.action as MemoAction] ?? m.action, urgent: m.urgent, at: jstDateKey(m.createdAt) })),
        link: "/phone-memos",
      };
    }
    case "get_tasks": {
      const today = jstDateKey(new Date());
      const owner = str(input.owner).replace(/(さん|様)$/, "").trim();
      const tasks = (await listTasks(companyId))
        .filter((t) => t.status === "OPEN")
        .filter((t) => (input.mine === true && ctx.userId ? t.ownerUserId === ctx.userId || t.ownerUserId === null : true))
        .filter((t) => (owner ? (t.ownerName ?? "").replace(/\s/g, "").includes(owner.replace(/\s/g, "")) : true));
      return {
        count: tasks.length,
        overdue: tasks.filter((t) => t.dueOn && t.dueOn < today).length,
        dueToday: tasks.filter((t) => t.dueOn === today).length,
        tasks: tasks.slice(0, 30).map((t) => ({ title: t.title, owner: t.ownerName ?? "担当なし", due: t.dueOn, overdue: !!t.dueOn && t.dueOn < today, party: t.partyName, repeat: repeatLabel(t.repeat) })),
        link: "/tasks",
      };
    }
    case "get_weekly_report": {
      const today = jstDateKey(new Date());
      const week = /^\d{4}-\d{2}-\d{2}$/.test(str(input.week)) && mondayOf(str(input.week)) <= today ? str(input.week) : defaultWeek(today);
      const f = await weeklyFacts(companyId, week, today);
      return { from: f.from, to: f.to, tasksDone: f.tasksDone.length, workHours: Math.round((f.work.minutes / 60) * 10) / 10, sales: f.sales, quotes: f.quotes, dealsWon: f.deals.won.length, overdueTasks: f.tasksOverdue.length, lateInvoices: f.lateInvoices, report: templateWeekly(f), link: "/reports/weekly" };
    }
    case "get_meeting_slots": {
      const found = str(input.name) ? await findPartyInText(companyId, str(input.name)) : { party: null };
      const me = ctx.userId ? await prisma.user.findUnique({ where: { id: ctx.userId }, select: { name: true } }) : null;
      const d = await draftScheduling(
        { id: ctx.userId, companyId, name: me?.name ?? "担当者" },
        { partyKind: found.party?.kind, partyId: found.party?.id, purpose: str(input.purpose), minutes: input.minutes, count: input.count, after: input.after, time: input.time },
      );
      return {
        party: found.party?.name ?? null,
        slots: d.slots.map((x) => slotLabel(x)),
        skippedBusyDays: d.busy,
        subject: d.subject,
        mail: d.body,
        link: found.party ? `/scheduling?kind=${found.party.kind}&id=${found.party.id}` : "/scheduling",
      };
    }
    case "get_business_calendar": {
      const today = jstDateKey(new Date());
      const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(str(input.month)) ? str(input.month) : today.slice(0, 7);
      const [y, m] = month.split("-").map(Number);
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const days = Array.from({ length: last }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
      const closures = await closureMap(companyId);
      let next = nextBusinessDay(new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10));
      for (let i = 0; i < 60 && !isCompanyOpen(next, closures); i++) next = nextBusinessDay(new Date(Date.parse(`${next}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10));
      return {
        month,
        holidays: [...holidaysOf(y)].filter(([k]) => k.startsWith(month)).map(([date, name]) => ({ date, name })),
        companyClosures: days.filter((d) => closures.has(d)).map((date) => ({ date, name: closures.get(date)! })),
        businessDays: days.filter((d) => isCompanyOpen(d, closures)).length,
        nextBusinessDay: next,
        note: "営業日は土日・祝日・年末年始(12/29〜1/3)と会社の休業日(会社の設定で登録)を除いた日",
      };
    }
    case "check_text": {
      const text = str(input.text).slice(0, 8000);
      if (!text.trim()) return { error: "確かめる文章がありません" };
      const issues = ruleCheck(text);
      return { count: issues.length, issues: issues.slice(0, 20).map((i) => ({ level: i.level, kind: i.kind, message: i.message, excerpt: i.excerpt, suggestion: i.suggestion })), link: "/proofread" };
    }
    case "get_business_analysis": {
      const today = jstDateKey(new Date());
      const fyStart = resolvePeriod({ preset: "this-fy" }, await getFiscalStartMonth(companyId)).from ?? `${today.slice(0, 4)}-01-01`;
      const from = /^\d{4}-\d{2}-\d{2}$/.test(str(input.from)) ? str(input.from) : fyStart;
      const to = /^\d{4}-\d{2}-\d{2}$/.test(str(input.to)) ? str(input.to) : today;
      const a = await getAnalysis(companyId, { from, to }, today);
      const e = templateExplanation(a);
      return {
        period: `${a.from}〜${a.to}`,
        figures: a.figures,
        metrics: a.metrics.map((m) => ({ name: m.label, unit: m.unit, current: m.current === null ? null : Math.round(m.current * 10) / 10, prior: m.prior === null ? null : Math.round(m.prior * 10) / 10, guide: m.guide })),
        summary: e.summary,
        strengths: e.strengths,
        concerns: e.concerns,
        link: "/analysis?preset=this-fy",
      };
    }
    case "simulate_scenario": {
      const structured = input.revenuePct !== undefined || Array.isArray(input.items) || Array.isArray(input.oneTime);
      const r = await runSimulation({ id: ctx.userId, companyId }, structured ? { scenario: { revenuePct: input.revenuePct ?? 0, items: input.items ?? [], oneTime: input.oneTime ?? [], notes: [] } } : { text: input.text });
      return {
        baseline: { monthlyRevenue: r.base.revenue, monthlyExpense: r.base.expense, cashNow: r.base.cash, basedOn: r.base.months },
        scenario: r.scenario,
        profit12Months: r.result.totals.profit,
        profit12MonthsIfNoChange: r.result.totals.baseProfit,
        cashIn12Months: r.result.totals.endCash,
        cashIn12MonthsIfNoChange: r.result.totals.baseEndCash,
        cashShortMonth: r.result.shortMonth,
        comments: r.result.comments,
        link: "/simulation",
      };
    }
    case "search_data": {
      const filters = parseSearch(str(input.query));
      if (!hasCondition(filters)) return { error: "探す言葉を入れてください" };
      const r = await runSearch(companyId, filters);
      return {
        understood: filters,
        total: r.total,
        results: r.groups.map((g) => ({ kind: KIND_LABELS[g.kind], items: g.hits.slice(0, 10).map((h) => ({ title: h.title, detail: h.subtitle, date: h.date, amount: h.amount, link: h.href })) })),
        link: `/search?q=${encodeURIComponent(str(input.query))}`,
      };
    }
    case "explain_journal": {
      const user = (ctx.userId && (await prisma.user.findUnique({ where: { id: ctx.userId }, select: { id: true, name: true } }))) || { id: ctx.userId, name: "AIアシスタント" };
      const r = await findAndExplainJournal(companyId, user, { keyword: str(input.keyword) || undefined, date: str(input.date) || undefined, amount: typeof input.amount === "number" ? input.amount : undefined, entryId: str(input.entryId) || undefined });
      if ("error" in r) return r;
      return { date: r.date, description: r.description, source: r.source, pattern: r.kind, lines: r.lines.map((l) => `${l.side} ${l.account} ${l.amount}円: ${l.meaning}`), effects: r.effects, explanation: r.story, points: r.points, cautions: r.cautions, link: "/journal" };
    }
    case "get_todos": {
      const todos = await getTodos(companyId);
      return { todos: todos.map((t) => ({ label: t.label, count: t.count, detail: t.detail, link: t.href })) };
    }
    default:
      return { error: `不明な道具です: ${name}` };
  }
}
