// 挨拶状のメール本文(画面のプレビューとサーバーの送信の両方で使う)
export type MailAddressee = { lines: string[]; main: string };
export type MailSender = {
  company: string;
  sender: string;
  phone: string | null;
  address: string | null;
};

// 手紙の言い方をメールの言い方に(「書中をもちまして」→「メールにて」)
const forMail = (p: string) =>
  p.replace(/書中をもちまして|書中にて|書面にて/g, "メールにて");

export function greetingMailText(
  to: MailAddressee,
  letter: { body: string[]; notes: string[] },
  me: MailSender,
) {
  const body = letter.body.map(forMail);
  // 本文の最後がもうお願いで終わっていれば、結びのあいさつは重ねない
  const closes = /(お願い申し上げます|よろしくお願いいたします)。?$/.test(
    body[body.length - 1] ?? "",
  );
  return [
    ...to.lines,
    to.main,
    "",
    `いつもお世話になっております。${me.company}の${me.sender}です。`,
    "",
    ...body.flatMap((para, i) => (i ? ["", para] : [para])),
    ...(letter.notes.length
      ? ["", "記", ...letter.notes.map((n) => `・${n}`), "以上"]
      : []),
    ...(closes && !letter.notes.length
      ? []
      : ["", "今後ともどうぞよろしくお願い申し上げます。"]),
    "",
    "--",
    me.company,
    me.sender,
    ...(me.address ? [me.address] : []),
    ...(me.phone ? [`TEL: ${me.phone}`] : []),
  ].join("\n");
}
