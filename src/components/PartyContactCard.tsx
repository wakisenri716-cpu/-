"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ContactForm, type ContactValues } from "@/components/ContactForm";

// 顧客・取引先の詳細画面の「住所・宛名」。編集と、送付状・封筒へのリンク
export function PartyContactCard({ kind, id, values }: { kind: "customer" | "vendor"; id: string; values: ContactValues }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const attention = [values.department, values.contactName && `${values.contactName} 様`].filter(Boolean).join(" ");
  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">住所・宛名</h2>
        <div className="flex flex-wrap gap-3 text-xs">
          {!editing && (
            <button onClick={() => setEditing(true)} className="text-indigo-700 hover:underline">
              編集
            </button>
          )}
          <Link href={`/letters/cover?kind=${kind}&id=${id}`} className="text-indigo-700 hover:underline">
            送付状
          </Link>
          {values.address && (
            <Link href={`/letters/envelope?kind=${kind}&id=${id}`} className="text-indigo-700 hover:underline">
              封筒
            </Link>
          )}
        </div>
      </div>
      {editing ? (
        <ContactForm
          kind={kind}
          id={id}
          values={values}
          onSaved={() => {
            setEditing(false);
            router.refresh();
          }}
          onCancel={() => setEditing(false)}
        />
      ) : values.address || attention || values.phone ? (
        <div className="text-sm">
          {values.address && (
            <p>
              {values.postalCode && `〒${values.postalCode} `}
              {values.address}
            </p>
          )}
          {attention && <p className="text-slate-600">{attention}</p>}
          {values.phone && <p className="text-slate-600">TEL: {values.phone}</p>}
        </div>
      ) : (
        <p className="text-sm text-slate-400">まだ住所が入っていません。「編集」から入れると、請求書などの宛先・送付状・封筒に使えます。</p>
      )}
    </section>
  );
}
