"use client";

import { useState } from "react";

// 登録・ようこそ画面で共通の「会社の情報」入力欄(フォームの中に置く。name 属性で送る)
export type CompanyDefaults = {
  companyName?: string;
  representative?: string;
  address?: string;
  phone?: string;
  companyEmail?: string;
  fiscalEndMonth?: number;
  registrationNumber?: string;
  taxMethod?: string;
  businessType?: number;
};

const inputClass = "mt-1 w-full rounded-md border px-3 py-2 text-sm";
const TAX = [
  { value: "GENERAL", label: "原則課税(一般的)" },
  { value: "SIMPLIFIED", label: "簡易課税(届出をしている)" },
  { value: "TWENTY_PERCENT", label: "2割特例(インボイス登録で課税事業者になった)" },
];
const BUSINESS = [
  { value: 1, label: "第1種 卸売業" },
  { value: 2, label: "第2種 小売業" },
  { value: 3, label: "第3種 製造業・建設業など" },
  { value: 4, label: "第4種 飲食店業・その他" },
  { value: 5, label: "第5種 サービス業など" },
  { value: 6, label: "第6種 不動産業" },
];

export function CompanyFields({ defaults = {} }: { defaults?: CompanyDefaults }) {
  const [taxMethod, setTaxMethod] = useState(defaults.taxMethod ?? "GENERAL");
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block text-sm sm:col-span-2">
        <span className="text-slate-600">
          会社名・屋号 <span className="text-rose-600">*</span>
        </span>
        <input name="companyName" required maxLength={100} defaultValue={defaults.companyName} autoComplete="organization" placeholder="例: 株式会社さくら商事 / さくら工房" className={inputClass} />
        <span className="mt-1 block text-xs text-slate-500">個人事業の方は屋号(なければお名前)を入れてください。請求書・見積書に載ります。</span>
      </label>
      <label className="block text-sm">
        <span className="text-slate-600">代表者名</span>
        <input name="representative" maxLength={60} defaultValue={defaults.representative} placeholder="例: 代表取締役 山田 太郎" className={inputClass} />
      </label>
      <label className="block text-sm">
        <span className="text-slate-600">電話番号</span>
        <input name="phone" type="tel" maxLength={30} defaultValue={defaults.phone} autoComplete="tel" placeholder="例: 03-1234-5678" className={inputClass} />
      </label>
      <label className="block text-sm sm:col-span-2">
        <span className="text-slate-600">住所</span>
        <input name="address" maxLength={200} defaultValue={defaults.address} autoComplete="street-address" placeholder="例: 〒100-0001 東京都千代田区千代田1-1" className={inputClass} />
      </label>
      <label className="block text-sm">
        <span className="text-slate-600">会社の連絡先メール</span>
        <input name="companyEmail" type="email" maxLength={254} defaultValue={defaults.companyEmail} placeholder="例: info@example.com" className={inputClass} />
        <span className="mt-1 block text-xs text-slate-500">請求書をメールで送るときの返信先になります。</span>
      </label>
      <label className="block text-sm">
        <span className="text-slate-600">
          決算月 <span className="text-rose-600">*</span>
        </span>
        <select name="fiscalEndMonth" defaultValue={defaults.fiscalEndMonth ?? 3} className={inputClass}>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <option key={m} value={m}>
              {m}月{m === 3 ? "(4月〜翌3月が1期)" : m === 12 ? "(1月〜12月が1期。個人事業はこちら)" : ""}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        <span className="text-slate-600">インボイス登録番号</span>
        <input name="registrationNumber" maxLength={20} defaultValue={defaults.registrationNumber} placeholder="T1234567890123" className={`${inputClass} font-mono`} />
        <span className="mt-1 block text-xs text-slate-500">インボイス(適格請求書発行事業者)に登録していなければ空欄にします。</span>
      </label>
      <label className="block text-sm">
        <span className="text-slate-600">消費税の計算方式</span>
        <select name="taxMethod" value={taxMethod} onChange={(e) => setTaxMethod(e.target.value)} className={inputClass}>
          {TAX.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <span className="mt-1 block text-xs text-slate-500">わからなければ「原則課税」のままで大丈夫です。あとで変えられます。</span>
      </label>
      {taxMethod === "SIMPLIFIED" && (
        <label className="block text-sm sm:col-span-2">
          <span className="text-slate-600">簡易課税の事業区分</span>
          <select name="businessType" defaultValue={defaults.businessType ?? 5} className={inputClass}>
            {BUSINESS.map((b) => (
              <option key={b.value} value={b.value}>
                {b.label}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

// 利用規約・プライバシーポリシーへの同意
export function TermsAgreement() {
  return (
    <label className="flex items-start gap-2 rounded-md bg-slate-50 px-3 py-2 text-sm">
      <input type="checkbox" name="agree" required className="mt-1" />
      <span>
        <a href="/terms" target="_blank" className="text-indigo-700 underline">
          利用規約
        </a>
        と
        <a href="/privacy" target="_blank" className="text-indigo-700 underline">
          プライバシーポリシー
        </a>
        を読み、同意します
      </span>
    </label>
  );
}
