import { useEffect, useState } from "react";
import { api, type Analysis, type StudentRow } from "./api";
import { AnalysisView, fingerLabel } from "./AnalysisView";
import { BarChart } from "./Charts";
import { Icon } from "./Icon";
import { filterStudents, nextSort, parseStudentLines, sortStudents, type Sort, type SortKey } from "./studentList";
import { shortDateJst } from "./time";

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "id", label: "学籍番号" },
  { key: "name", label: "名前" },
  { key: "sessions", label: "プレイ" },
  { key: "questions", label: "問題数" },
  { key: "wpm", label: "WPM" },
  { key: "cpm", label: "文字/分" },
  { key: "accuracy", label: "正確率" },
  { key: "lastPlayed", label: "最後の練習" },
];

// 教員の画面: 学生一覧（検索・並べ替え・追加・名前の変更・削除）→ 学生ごとの分析。CSV の取り出し。
export function TeacherView() {
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [selected, setSelected] = useState<{ id: string; name: string; analysis: Analysis } | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>({ key: "id", dir: "asc" });

  const reload = () =>
    api
      .students()
      .then(setStudents)
      .catch((e) => setError(e.message));
  useEffect(() => {
    reload();
  }, []);

  async function run(action: () => Promise<unknown>, done: string) {
    setError("");
    setMessage("");
    try {
      await action();
      setMessage(done);
      await reload();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    }
  }

  async function rename(s: StudentRow) {
    const name = prompt(`${s.id} の新しい名前`, s.name);
    if (name === null || name.trim() === s.name) return;
    await run(() => api.renameStudent(s.id, name), `${s.id} の名前を「${name.trim()}」に変えました`);
  }

  async function remove(s: StudentRow) {
    if (!confirm(`${s.name}（${s.id}）を削除しますか？（元に戻せません）`)) return;
    await run(() => api.deleteStudent(s.id), `${s.name}（${s.id}）を削除しました`);
  }

  const shown = sortStudents(filterStudents(students, query), sort);

  async function open(id: string) {
    setError("");
    try {
      const a = await api.studentAnalysis(id);
      setSelected({ id: a.user.id, name: a.user.name, analysis: a });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function downloadCsv() {
    setError("");
    try {
      const blob = await api.logsCsv();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "logs.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (selected)
    return (
      <div className="card">
        <button className="link" onClick={() => setSelected(null)}>
          ← 学生一覧に戻る
        </button>
        <h2 className="section-title">
          <Icon name="user" />
          {selected.name}（{selected.id}）の学習状況
        </h2>
        <AnalysisView analysis={selected.analysis} />
      </div>
    );

  return (
    <div className="card">
      <h2 className="section-title">
        <Icon name="users" />
        学生一覧
      </h2>
      {message && (
        <p className="ok-message" role="status">
          <Icon name="check" />
          {message}
        </p>
      )}
      <div className="list-tools">
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="学籍番号・名前で検索" aria-label="学生を検索" />
        <span className="muted">
          {shown.length} 人{query.trim() !== "" ? `（全 ${students.length} 人中）` : ""}。見出しを押すと並べ替えます
        </span>
      </div>
      <div className="table-scroll">
        <table className="student-table">
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th key={c.key} aria-sort={sort.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}>
                  <button className="sort-button" onClick={() => setSort(nextSort(sort, c.key))}>
                    {c.label}
                    <span className="sort-mark">{sort.key === c.key ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}</span>
                  </button>
                </th>
              ))}
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length + 1} className="muted">
                  {students.length === 0 ? "学生が登録されていません。下の「学生を追加」から追加してください。" : "見つかりません"}
                </td>
              </tr>
            )}
            {shown.map((s) => (
              <tr key={s.id}>
                <td>
                  <button className="link" onClick={() => open(s.id)}>
                    {s.id}
                  </button>
                </td>
                <td>{s.name}</td>
                <td>{s.sessions}</td>
                <td>{s.questions}</td>
                <td>{s.questions > 0 ? s.total.wpm.toFixed(1) : "-"}</td>
                <td>{s.questions > 0 ? s.total.cpm.toFixed(0) : "-"}</td>
                <td>{s.questions > 0 ? pct(s.total.accuracy) : "-"}</td>
                <td>{s.lastPlayed ? shortDateJst(s.lastPlayed) : "-"}</td>
                <td className="row-ops">
                  <button className="link" onClick={() => rename(s)} aria-label="名前を変更" title="名前を変更">
                    変更
                  </button>
                  {/* 練習の記録がある学生は、記録を守るため削除しない */}
                  {s.questions === 0 && (
                    <button className="link danger-link" onClick={() => remove(s)}>
                      削除
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <AddStudents onAdd={(users, keyboard) => run(() => api.addStudents(users, keyboard), `${users.length} 人を追加しました`)} />
      <ClassWeakness />
      <div className="csv-row">
        <button onClick={downloadCsv}>
          <Icon name="download" />
          記録を CSV で保存
        </button>
        <p className="muted">CSV には logs の全記録と、その場で計算した所要時間・正確率・WPM・文字/分 が入ります。</p>
      </div>
      {error && (
        <p className="error" role="alert">
          <Icon name="alert" />
          {error}
        </p>
      )}
    </div>
  );
}

// 学生の追加。1 行に「学籍番号,名前」（1 人でも、まとめてでも）
function AddStudents({ onAdd }: { onAdd: (users: { id: string; name: string }[], keyboard: boolean) => Promise<boolean> }) {
  const [text, setText] = useState("");
  const [keyboard, setKeyboard] = useState(true);
  const parsed = parseStudentLines(text);
  return (
    <div className="manage-box new-box add-students">
      <div className="box-heading">学生を追加</div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-label="追加する学生"
        placeholder={"1 行に「学籍番号,名前」（まとめて貼り付けできます）\ny230018,山田 太郎\ny230028,佐藤 花子"}
        rows={4}
      />
      <label className="inline-check">
        <input type="checkbox" checked={keyboard} onChange={(e) => setKeyboard(e.target.checked)} />
        標準のキーボードの設定（Keyball44 の指の割り当て）を付ける（指ごとのミス率に使います）
      </label>
      {parsed.errors.length > 0 && <p className="error">{parsed.errors.join(" / ")}</p>}
      <div className="row-actions">
        <button
          className="secondary"
          disabled={parsed.users.length === 0 || parsed.errors.length > 0}
          onClick={async () => {
            if (await onAdd(parsed.users, keyboard)) setText("");
          }}
        >
          {parsed.users.length > 0 ? `${parsed.users.length} 人を追加` : "追加"}
        </button>
        <span className="muted">学籍番号は半角の英数字（大文字は小文字にそろえます）。追加した学生は、すぐその学籍番号でログインできます。</span>
      </div>
    </div>
  );
}

// クラス全体の苦手（全学生の記録から計算。授業で何を重点にするかの判断に使う）
function ClassWeakness() {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.classWeakness>> | null>(null);
  useEffect(() => {
    api
      .classWeakness()
      .then(setData)
      .catch(() => setData(null));
  }, []);
  if (!data || data.students === 0) return null;
  return (
    <section aria-label="クラス全体の苦手">
      <h3 className="section-title">
        <Icon name="target" />
        クラス全体の苦手（練習した {data.students} 人の記録から）
      </h3>
      {data.chars.length > 0 ? (
        <BarChart
          title="間違えやすい文字（ミス率の高い順・上位 10）"
          bars={data.chars.map((c) => ({ label: c.char, value: c.missRate, note: `${c.misses} / ${c.attempts} 回` }))}
          format={pct}
        />
      ) : (
        <p className="muted">2 回以上出た文字で、間違えた文字はありません。</p>
      )}
      <BarChart
        title="指ごとのミス率"
        bars={data.fingers.map((f) => ({ label: fingerLabel(f.finger), value: f.missRate, note: `${f.misses} / ${f.attempts} 回` }))}
        format={pct}
      />
    </section>
  );
}
