import { useEffect, useState } from "react";
import { api, type AdminStage, type TeacherAssignment } from "./api";
import { Icon } from "./Icon";
import { dateInputJst, endOfDayJstIso, shortDateJst } from "./time";

// 教員の課題の画面: 課題を出す（レベル・締め切り・回数・正確率の条件）、編集・削除、学生ごとの達成の確認。
// 達成は logs から毎回計算する（10 問すべて解いたプレイで、正確率の条件を満たしたものを数える）。
export function Assignments() {
  const [list, setList] = useState<TeacherAssignment[]>([]);
  const [stages, setStages] = useState<AdminStage[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState<number | null>(null);

  const reload = () =>
    Promise.all([api.teacherAssignments(), api.adminStages()])
      .then(([a, s]) => {
        setList(a);
        setStages(s);
      })
      .catch((e) => setError(e.message));
  useEffect(() => {
    reload();
  }, []);

  async function run(f: () => Promise<unknown>, done: string) {
    setError("");
    setMessage("");
    try {
      await f();
      setMessage(done);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  const levels = stages.flatMap((s) => s.levels.map((l) => ({ id: l.id, title: `${s.title} / ${l.title}`, pass: l.pass_accuracy })));

  return (
    <div className="card">
      <h2 className="section-title">
        <Icon name="check" />
        課題
      </h2>
      <p className="muted">
        レベル・締め切り・回数・正確率の条件を決めて課題を出します。学生のトップに表示され、達成すると「達成」になります。
        数えるのは、課題を出してから締め切りまでの、10
        問すべて解いたプレイです。正確率の条件を空欄にすると、レベルの合格の目安を使います（それもなければ 10 問解けば数えます）。
      </p>
      {message && (
        <p className="ok-message" role="status">
          <Icon name="check" />
          {message}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          <Icon name="alert" />
          {error}
        </p>
      )}

      <AssignmentForm
        levels={levels}
        submitLabel="課題を出す"
        onSubmit={(b) => run(() => api.createAssignment(b), `課題「${b.title}」を出しました`)}
      />

      {list.length === 0 && <p className="muted">まだ課題はありません。</p>}
      <ul className="kb-list">
        {list.map((a) => (
          <li
            key={`${a.id}:${a.title}:${a.dueAt}:${a.requiredPlays}:${a.minAccuracy}:${a.levelId}`}
            className="manage-box"
            aria-label={`課題 ${a.title}`}
          >
            <div className="assignment-head">
              <div className="assignment-main">
                <strong>{a.title}</strong>
                <span className="muted">
                  {a.levelTitle}・{shortDateJst(a.dueAt)} まで・{a.requiredPlays} 回
                  {a.minAccuracy !== null ? `・正確率 ${Math.round(a.minAccuracy * 100)}% 以上` : ""}
                </span>
              </div>
              <span className="assignment-state">
                達成 {a.achievedCount} / {a.students.length} 人
              </span>
              <div className="row-actions">
                <button className="secondary" onClick={() => setOpen(open === a.id ? null : a.id)} aria-expanded={open === a.id}>
                  {open === a.id ? "閉じる" : "達成状況・編集"}
                </button>
                <button
                  className="danger"
                  onClick={() =>
                    confirm(`課題「${a.title}」を削除しますか？（学生の画面から消えます。練習の記録は残ります）`) &&
                    run(() => api.deleteAssignment(a.id), `課題「${a.title}」を削除しました`)
                  }
                >
                  削除
                </button>
              </div>
            </div>
            {open === a.id && (
              <>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>学籍番号</th>
                        <th>名前</th>
                        <th>回数</th>
                        <th>状態</th>
                      </tr>
                    </thead>
                    <tbody>
                      {a.students.map((u) => (
                        <tr key={u.id}>
                          <td>{u.id}</td>
                          <td>{u.name}</td>
                          <td>
                            {u.done} / {u.required}
                          </td>
                          <td className={u.achieved ? "ok-text" : undefined}>
                            {u.achieved ? "達成" : u.overdue ? "未達成（締め切り後）" : "取り組み中"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <AssignmentForm
                  levels={levels}
                  initial={a}
                  submitLabel="変更を保存"
                  onSubmit={(b) => run(() => api.updateAssignment(a.id, b), `課題「${b.title}」を変更しました`)}
                />
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function AssignmentForm({
  levels,
  initial,
  submitLabel,
  onSubmit,
}: {
  levels: { id: number; title: string; pass: number | null }[];
  initial?: TeacherAssignment;
  submitLabel: string;
  onSubmit: (b: { title: string; levelId: number; dueAt: string; requiredPlays: number; minAccuracy: number | null }) => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [levelId, setLevelId] = useState(initial ? String(initial.levelId) : "");
  const [due, setDue] = useState(initial ? dateInputJst(initial.dueAt) : "");
  const [plays, setPlays] = useState(String(initial?.requiredPlays ?? 1));
  const [acc, setAcc] = useState(initial?.minAccuracy != null ? String(Math.round(initial.minAccuracy * 100)) : "");
  const ok = title.trim() !== "" && levelId !== "" && due !== "" && Number(plays) >= 1 && (acc === "" || (Number(acc) > 0 && Number(acc) <= 100));
  return (
    <form
      className={`manage-box assignment-form${initial ? "" : " new-box"}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (!ok) return;
        onSubmit({
          title: title.trim(),
          levelId: Number(levelId),
          dueAt: endOfDayJstIso(due),
          requiredPlays: Number(plays),
          minAccuracy: acc === "" ? null : Number(acc) / 100,
        });
        if (!initial) {
          setTitle("");
          setAcc("");
        }
      }}
    >
      {!initial && <div className="box-heading">課題を出す</div>}
      <div className="assignment-grid">
        <label>
          課題名
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例: 人差し指の練習を 3 回" maxLength={100} />
        </label>
        <label>
          レベル
          <select value={levelId} aria-label="課題のレベル" onChange={(e) => setLevelId(e.target.value)}>
            <option value="">選んでください</option>
            {levels.map((l) => (
              <option key={l.id} value={l.id}>
                {`${l.title}${l.pass !== null ? `（合格の目安 ${Math.round(l.pass * 100)}%）` : ""}`}
              </option>
            ))}
          </select>
        </label>
        <label>
          締め切り（この日の終わりまで）
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </label>
        <label>
          回数
          <input type="number" min={1} max={100} value={plays} onChange={(e) => setPlays(e.target.value)} />
        </label>
        <label>
          正確率の条件（%）
          <input type="number" min={1} max={100} value={acc} onChange={(e) => setAcc(e.target.value)} placeholder="空欄: レベルの目安" />
        </label>
      </div>
      <button type="submit" disabled={!ok}>
        {submitLabel}
      </button>
    </form>
  );
}
