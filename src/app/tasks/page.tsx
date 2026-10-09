import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { aiEnabled } from "@/lib/ai/access";
import { jstDateKey } from "@/lib/jst";
import { listTasks, taskContext } from "@/lib/teamTasks";
import TaskView from "./TaskView";
import { closureMap } from "@/lib/companyClosures";

export const dynamic = "force-dynamic";

export default async function TasksPage() {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const [tasks, ctx, ai, closures] = await Promise.all([
    listTasks(companyId),
    taskContext(companyId),
    aiEnabled(companyId),
    closureMap(companyId),
  ]);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">社内のやること</h1>
        <p className="mt-1 text-sm text-slate-600">
          「明日までに田中さんがさくら商事に見積を送る」のように1行に1つ書いて「分ける」を押すと、やること・担当・期限・取引先に分けて登録します。
          {ai
            ? "メールや会議のメモを貼って「AIで拾い出す」を押すと、文章の中からやることを拾います。"
            : ""}
          期限が来たやることは担当の人のやることリストに出ます。「毎月25日 給料を振り込む」「毎週月曜 売上を報告する」のように書くと繰り返しのやることになり、済みにすると次の回が入ります。議事録・訪問のあとでのやることもここに入れられます。
        </p>
      </div>
      <TaskView
        closures={Object.fromEntries(closures)}
        initial={JSON.parse(JSON.stringify(tasks))}
        users={ctx.users.map((u) => ({
          id: u.id,
          name: u.name,
          email: !!u.email,
        }))}
        parties={ctx.parties.map((p) => ({
          kind: p.kind,
          id: p.id,
          name: p.name,
        }))}
        viewerId={user.id}
        today={jstDateKey(new Date())}
        ai={ai}
      />
    </div>
  );
}
