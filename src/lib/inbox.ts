import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";
import { formatYen } from "@/lib/format";
import { getAiProvider } from "@/lib/ai";
import type { DocumentClassification } from "@/lib/ai/types";
import { createInvoiceFromUpload } from "@/lib/accounting/invoiceUpload";
import { addReceiptToReport } from "@/lib/accounting/receiptUpload";
import { createContractFromFile } from "@/lib/contracts";
import { createFolder, MAX_FILE_BYTES, saveFile, sniffType } from "@/lib/files";

// AI受付箱: 書類(画像・PDF)を入れるだけで、AIがどんな書類かを見分けて振り分ける。
// ・受け取った請求書 → 請求書として登録(仕訳も)
// ・領収書・レシート → 入れた人の経費精算に追加(仕訳も)
// ・契約書 → 書類フォルダ「契約書」に保存し、満了日・更新日を期限にする
// ・その他 → 書類フォルダ「AI受付箱」に保存
// 読み取りに失敗したときも、ファイルは「AI受付箱」フォルダに残す。

const ALLOWED = ["application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
type User = { id: string; name: string; companyId: string };

async function folderNamed(companyId: string, name: string) {
  return (await prisma.folder.findFirst({ where: { companyId, parentId: null, name } })) ?? (await createFolder(companyId, { name }));
}

async function keepFile(companyId: string, user: User, file: File, folderName: string, c: DocumentClassification | null, note?: string) {
  const folder = await folderNamed(companyId, folderName);
  const saved = await saveFile(companyId, { file, folderId: folder.id, uploadedByName: user.name });
  const memo = [c?.summary, c?.counterparty && `相手: ${c.counterparty}`, c?.amount && `金額: ${formatYen(c.amount)}`, note].filter(Boolean).join(" / ").slice(0, 500) || null;
  await prisma.storedFile.update({
    where: { id: saved.id },
    data: { memo, ...(c?.endDate && DATE.test(c.endDate) ? { expiresOn: new Date(`${c.endDate}T00:00:00Z`) } : {}) },
  });
  return { id: saved.id, href: `/files?folder=${folder.id}` };
}

async function ownReport(user: User) {
  return (
    (await prisma.expenseReport.findFirst({ where: { companyId: user.companyId, employeeId: user.id, approvalStatus: { in: ["DRAFT", "RETURNED"] }, reimbursedAt: null }, orderBy: { createdAt: "desc" } })) ??
    (await prisma.expenseReport.create({ data: { companyId: user.companyId, employeeId: user.id, status: "DRAFT" } }))
  );
}

export async function processInboxFile(user: User, file: File) {
  if (file.size === 0) throw new UserError(`「${file.name}」は空のファイルです`);
  if (file.size > MAX_FILE_BYTES) throw new UserError(`「${file.name}」は大きすぎます(4MBまで)`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mediaType = sniffType(bytes);
  if (!mediaType || !ALLOWED.includes(mediaType)) throw new UserError(`「${file.name}」は読み取れない種類です(PDF・画像だけ)`);
  const base64 = Buffer.from(bytes).toString("base64");
  const companyId = user.companyId;

  let c: DocumentClassification | null = null;
  let resultType = "FILE";
  let resultId: string | null = null;
  let href = "/files";
  let status = "DONE";
  let note: string | null = null;
  try {
    c = await (await getAiProvider(companyId)).classifyDocument({ base64, mediaType, fileName: file.name });
    if (c.kind === "RECEIVED_INVOICE") {
      const { invoice, matchedOrder } = await createInvoiceFromUpload(companyId, "RECEIVED", base64, mediaType);
      resultType = "INVOICE";
      resultId = invoice.id;
      href = "/invoices?direction=RECEIVED";
      note = `受け取った請求書として登録しました(${invoice.vendor?.name ?? "取引先不明"}・${formatYen(invoice.totalAmount)})${matchedOrder ? `。発注書 ${matchedOrder.orderNumber} と金額が合ったので検収済みにしました` : ""}`;
    } else if (c.kind === "RECEIPT") {
      const { item } = await addReceiptToReport(await ownReport(user), base64, mediaType);
      resultType = "EXPENSE";
      resultId = item.id;
      href = "/expenses";
      note = `あなたの経費精算に追加しました(${item.description}・${formatYen(item.amount)})`;
    } else {
      const kept = await keepFile(companyId, user, file, c.kind === "CONTRACT" ? "契約書" : "AI受付箱", c);
      resultId = kept.id;
      href = kept.href;
      note = c.kind === "CONTRACT" ? `書類フォルダ「契約書」に保存しました${c.endDate ? `(期限 ${c.endDate.replaceAll("-", "/")} をお知らせします)` : ""}` : "書類フォルダ「AI受付箱」に保存しました";
      if (c.kind === "CONTRACT") {
        // 契約書は台帳にも登録する(自動更新・解約の申し出期限などをAIが読み取る)。うまくいかなくてもファイルは残っている
        try {
          await createContractFromFile(user, kept.id);
          href = "/contracts";
          note += "。契約書の台帳にも登録しました";
        } catch (error) {
          console.error("契約書の台帳に登録できませんでした", error);
        }
      }
    }
  } catch (error) {
    // 読み取れなかったものもファイルは残し、人が確かめられるようにする
    const reason = error instanceof UserError ? error.message : "AIで読み取れませんでした";
    const kept = await keepFile(companyId, user, file, "AI受付箱", c, `要確認: ${reason}`);
    resultType = "FILE";
    resultId = kept.id;
    href = kept.href;
    status = "ATTENTION";
    note = `${reason}。書類フォルダ「AI受付箱」に保存したので、確かめて登録してください`;
  }

  return prisma.inboxItem.create({
    data: {
      companyId,
      userId: user.id,
      userName: user.name,
      fileName: file.name.slice(0, 200),
      kind: c?.kind ?? "OTHER",
      title: (c?.title ?? "書類").slice(0, 100),
      summary: (c?.summary ?? "").slice(0, 500),
      confidence: c?.confidence ?? 0,
      status,
      resultType,
      resultId,
      href,
      note: note?.slice(0, 300) ?? null,
    },
  });
}

export async function listInbox(companyId: string) {
  return prisma.inboxItem.findMany({ where: { companyId }, orderBy: { createdAt: "desc" }, take: 50 });
}
