// 使い方ガイドブック(/guide)に載せる画面の写真を撮る。
// 使い方: デモデータを入れた開発サーバー(npx next dev -p 3100)を動かしてから
//   node scripts/guide-screenshots.mjs [出力先=public/guide]
// 押すボタンなどは、赤い枠と「ここ」の印で目立たせる。
import { chromium } from "playwright";

const BASE = process.env.GUIDE_BASE_URL || "http://localhost:3100";
const OUT = process.argv[2] || "public/guide";
const USERS = {
  admin: { email: "boss@example.com", password: "boss-pass-1" },
  employee: { email: "emp@example.com", password: "emp-pass-1" },
};

// file: 保存する名前 / path: 開く画面 / mark: 目立たせる文字(ボタン・リンクなど) / click: 先に押すもの / phone: スマホの大きさで撮る
const SHOTS = [
  { file: "welcome", path: "/welcome", user: "employee", mark: "同意してはじめる" },
  { file: "dashboard", path: "/", user: "admin" },
  { file: "company", path: "/company", user: "admin", mark: "会社名・屋号" },
  { file: "users", path: "/users", user: "admin", mark: "追加" },
  { file: "vendors", path: "/vendors", user: "admin", mark: "インボイス登録" },
  { file: "quotes", path: "/quotes", user: "admin", mark: "+ 見積書を作成" },
  { file: "invoice-new", path: "/invoices/new", user: "admin", mark: "請求書を作成", fill: [["input[list=customers]", "株式会社ひかり商事"]] },
  { file: "invoice-print", path: "/invoices", user: "admin", click: ["発行請求書(売上)", "INV-202609-001"], mark: "メールで送る" },
  { file: "receivables", path: "/receivables", user: "admin", mark: "売掛金(入金待ち)" },
  { file: "purchase-order", path: "/purchase-orders", user: "admin", click: ["PO-202609-002"], mark: "検収する" },
  { file: "transfers", path: "/transfers", user: "admin", mark: "振込データ" },
  { file: "expenses-phone", path: "/expenses", user: "employee", mark: "レシートを追加", phone: true },
  { file: "reimbursements", path: "/reimbursements", user: "admin", mark: "精算する" },
  { file: "advances", path: "/advances", user: "admin", mark: "精算する" },
  { file: "bank", path: "/bank", user: "admin", mark: "確定" },
  { file: "shifts", path: "/shifts", user: "admin", mark: "シフト管理" },
  { file: "timeclock-phone", path: "/timeclock", user: "employee", mark: "山田 花子", phone: true },
  { file: "payroll", path: "/payroll", user: "admin", mark: "給与明細" },
  { file: "staff-records", path: "/staff-records", user: "admin", mark: "労働者名簿を印刷" },
  { file: "requests", path: "/requests", user: "admin", click: ["承認待ち (1)"], mark: "承認待ち (1)" },
  { file: "notices", path: "/notices", user: "admin", mark: "+ お知らせを書く" },
  { file: "files", path: "/files", user: "admin", mark: "書類フォルダ" },
  { file: "journal", path: "/journal", user: "admin", mark: "仕訳を登録" },
  { file: "income-statement", path: "/income-statement?preset=all", user: "admin", mark: "損益計算書" },
  { file: "projects", path: "/projects", user: "admin", mark: "ひかり商事 Webサイト制作" },
  { file: "tax", path: "/tax?preset=all", user: "admin", mark: "納める見込み" },
  { file: "monthly-close", path: "/monthly-close?month=2026-08", user: "admin", mark: "開く →" },
  { file: "closing", path: "/closing", user: "admin", mark: "締め処理" },
  { file: "accountant-export", path: "/accountant-export", user: "admin", mark: "税理士向けデータ" },
  { file: "account", path: "/account", user: "admin", mark: "2段階認証" },
];

async function login(browser, user, phone) {
  const context = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 800 }, deviceScaleFactor: phone ? 2 : 1 });
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill("input[type=email]", USERS[user].email);
  await page.fill("input[type=password]", USERS[user].password);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login")), page.click("button[type=submit]")]);
  return page;
}

// 文字で要素を探して、赤い枠と「ここ」の印を付け、画面に入るようにスクロールする
async function mark(page, text) {
  // ボタン・リンクの名前がぴったり合うもの → 名前を含むもの → 文字を含むもの の順に探す
  const candidates = [
    page.getByRole("button", { name: text, exact: true }),
    page.getByRole("link", { name: text, exact: true }),
    page.getByRole("button", { name: text }),
    page.getByRole("link", { name: text }),
    page.getByText(text),
  ];
  let target = null;
  for (const c of candidates) {
    if (await c.count()) {
      target = c.first();
      break;
    }
  }
  if (!target) return console.warn(`  見つからない: ${text}`);
  await target.evaluate((el) => {
    // 真ん中あたりに来るようにスクロールしてから、印の位置を決める
    el.scrollIntoView({ block: "center" });
    el.style.outline = "3px solid #E0522D";
    el.style.outlineOffset = "3px";
    el.style.borderRadius = el.style.borderRadius || "6px";
    const r = el.getBoundingClientRect();
    const tag = document.createElement("div");
    tag.textContent = "ここ";
    Object.assign(tag.style, {
      position: "fixed",
      left: `${Math.max(4, r.left - 6)}px`,
      top: `${Math.max(4, r.top - 30)}px`,
      background: "#E0522D",
      color: "white",
      font: "bold 13px sans-serif",
      padding: "3px 8px",
      borderRadius: "999px",
      zIndex: 9999,
      boxShadow: "0 1px 3px rgba(0,0,0,.3)",
    });
    document.body.appendChild(tag);
  });
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium" });
const pages = {};
// ONLY=welcome,dashboard のように指定すると、その写真だけ撮り直す。SKIP=welcome で除く
// (welcome は、利用規約にまだ同意していない従業員で撮る)
const only = process.env.ONLY?.split(",");
const skip = process.env.SKIP?.split(",") ?? [];
for (const shot of SHOTS.filter((s) => (!only || only.includes(s.file)) && !skip.includes(s.file))) {
  const key = `${shot.user}-${shot.phone ? "phone" : "pc"}`;
  pages[key] ??= await login(browser, shot.user, shot.phone);
  const page = pages[key];
  await page.goto(BASE + shot.path);
  await page.waitForLoadState("networkidle");
  for (const text of shot.click ?? []) {
    const before = page.url();
    await page.getByText(text, { exact: true }).first().click();
    // リンクなら次の画面に移るまで待つ(タブの切り替えなら移らない)
    await page.waitForURL((u) => u.href !== before, { timeout: 3000 }).catch(() => {});
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(300);
  }
  for (const [selector, value] of shot.fill ?? []) await page.fill(selector, value);
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  await page.waitForTimeout(500);
  if (shot.mark) await mark(page, shot.mark);
  await page.waitForTimeout(200);
  // パソコンの画面は左のメニューを切り落として、中身を大きく見せる
  const clip = shot.phone ? undefined : { x: 240, y: 0, width: 1040, height: 800 };
  await page.screenshot({ path: `${OUT}/${shot.file}.jpg`, type: "jpeg", quality: 75, clip });
  console.log(shot.file);
}
await browser.close();
