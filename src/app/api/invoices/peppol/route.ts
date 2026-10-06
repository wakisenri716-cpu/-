import { requireCompanyId } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { UserError } from "@/lib/errors";
import { importPeppolInvoice } from "@/lib/peppol";
import { audit } from "@/lib/audit";

// 受け取ったデジタルインボイス(XML)を読み込む。file(フォームのファイル)か、本文そのままの XML
export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  return respond(async () => {
    let xml: string;
    if ((request.headers.get("content-type") ?? "").includes("multipart/form-data")) {
      const file = (await request.formData()).get("file");
      if (!(file instanceof File)) throw new UserError("XML のファイルを選んでください");
      xml = await file.text();
    } else {
      xml = await request.text();
    }
    const r = await importPeppolInvoice(companyId, xml.replace(/^﻿/, ""));
    await audit("デジタルインボイスを取り込み", `${r.vendor} ${r.number}`);
    return r;
  }, 201);
}
