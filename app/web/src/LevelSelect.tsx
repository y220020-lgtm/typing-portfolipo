import { useEffect, useState } from "react";
import { api, keyboardChoice, type Analysis, type Keyboard, type MyAssignment, type Session, type Stage, type User } from "./api";
import { shortDateJst } from "./time";
import { Icon } from "./Icon";

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

// 学生のトップ: 自分の成績のまとめ（/api/me/analysis の値だけを使う）と、ステージ・レベルの選択
export function LevelSelect({
  user,
  onStart,
  onAnalysis,
  onStartTraining,
  onKeyboards,
  notice,
}: {
  user: User;
  onStart: (session: Session) => void;
  onAnalysis: () => void;
  onStartTraining: (keyboardId: number | null) => void; // 待ちの画面と問題の取得は App が行う
  onKeyboards: () => void; // キーボードの設定へ
  notice: string; // トレーニングの問題を用意できなかったときの理由
}) {
  const [stages, setStages] = useState<Stage[]>([]);
  const [keyboards, setKeyboards] = useState<Keyboard[]>([]);
  const [keyboardId, setKeyboardId] = useState<number | null>(null);
  const [summary, setSummary] = useState<Analysis | null>(null);
  const [assignments, setAssignments] = useState<MyAssignment[]>([]);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false); // 問題を準備中（AI を使う設定では数秒かかることがある）

  useEffect(() => {
    Promise.all([api.stages(), api.keyboards()])
      .then(([s, k]) => {
        setStages(s);
        setKeyboards(k);
        const saved = keyboardChoice.get();
        const id = saved !== null && k.some((x) => x.id === saved) ? saved : (k[0]?.id ?? null);
        setKeyboardId(id);
        keyboardChoice.set(id);
      })
      .catch((e) => setError(e.message));
    // 成績のまとめは、取れなくても練習には困らないので、失敗しても画面は出す
    api
      .myAnalysis()
      .then(setSummary)
      .catch(() => setSummary(null));
    api
      .myAssignments()
      .then(setAssignments)
      .catch(() => setAssignments([]));
  }, [user.id]);

  async function start(levelId: number) {
    if (starting) return;
    setStarting(true);
    setError("");
    try {
      onStart(await api.startSession(levelId, keyboardId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStarting(false);
    }
  }

  const total = summary?.total;
  const played = (summary?.sessions.length ?? 0) > 0;

  return (
    <div>
      <section className="card welcome">
        <div>
          <h2>こんにちは、{user.name} さん</h2>
          <p>{played ? "これまでの練習のまとめです。続けて練習しましょう。" : "下のレベルを選んで、最初の練習を始めましょう。"}</p>
        </div>
        {played && total && (
          <div className="stats" aria-label="これまでの成績">
            <div>
              <span className="value">{summary!.sessions.length}</span>
              <span className="label">プレイ回数</span>
            </div>
            <div>
              <span className="value">{total.questions}</span>
              <span className="label">解いた問題</span>
            </div>
            <div>
              <span className="value">{total.wpm.toFixed(1)}</span>
              <span className="label">平均 WPM</span>
            </div>
            <div>
              <span className="value">{pct(total.accuracy)}</span>
              <span className="label">正確率</span>
            </div>
          </div>
        )}
        <button className="secondary" onClick={onAnalysis}>
          <Icon name="chart" />
          これまでの記録を見る
        </button>
      </section>

      <div className="card toolbar">
        <div className="section-title">
          <Icon name="keyboard" />
          <strong>練習の設定</strong>
        </div>
        <label>
          使うキーボード
          <select
            value={keyboardId ?? ""}
            onChange={(e) => {
              const id = e.target.value === "" ? null : Number(e.target.value);
              setKeyboardId(id);
              keyboardChoice.set(id);
            }}
          >
            {keyboards.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name}
              </option>
            ))}
            <option value="">指定しない</option>
          </select>
        </label>
        <button className="link" onClick={onKeyboards}>
          キーボードの設定
        </button>
      </div>

      {assignments.length > 0 && (
        <section className="card" aria-label="課題">
          <h2 className="section-title">
            <Icon name="check" />
            課題
          </h2>
          <ul className="assignments">
            {assignments.map((a) => (
              <li key={a.id} className={a.achieved ? "achieved" : a.overdue ? "overdue" : undefined}>
                <div className="assignment-main">
                  <strong>{a.title}</strong>
                  <span className="muted">
                    {a.levelTitle}・{shortDateJst(a.dueAt)} まで・{a.requiredPlays} 回
                    {a.threshold !== null ? `（正確率 ${Math.round(a.threshold * 100)}% 以上、10 問すべて）` : "（10 問すべて）"}
                  </span>
                </div>
                <span className="assignment-state">{a.achieved ? "達成" : a.overdue ? "締め切りを過ぎました" : `${a.done} / ${a.required} 回`}</span>
                {!a.achieved && !a.overdue && (
                  <button className="secondary" onClick={() => start(a.levelId)} disabled={starting}>
                    練習する
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card training-card">
        <div>
          <h2 className="section-title">
            <Icon name="target" />
            苦手克服トレーニング
          </h2>
          <p className="muted">
            練習の記録から苦手な文字・指・速さを分析し、苦手を補う問題を自動で作ります。解くたびに分析し直して、次の問題を作ります。
          </p>
        </div>
        <button className="lg" onClick={() => onStartTraining(keyboardId)} disabled={starting}>
          <Icon name="play" />
          トレーニングを始める
        </button>
      </section>

      {starting && <p className="muted">問題を準備しています…</p>}
      {(error || notice) && (
        <p className="error" role="alert">
          <Icon name="alert" />
          {error || notice}
        </p>
      )}

      {stages.map((stage, si) => (
        <section key={stage.id} className="card stage-card">
          <h2>
            <span className="stage-number" aria-hidden="true">
              {si + 1}
            </span>
            {stage.title}
          </h2>
          {stage.description && <p className="muted">{stage.description}</p>}
          <ul className="levels">
            {stage.levels.map((level) => (
              <li key={level.id}>
                {/* ボタンの名前はレベル名（説明は見た目だけ。読み上げでは説明を title で補う） */}
                <button
                  className="level-tile"
                  onClick={() => start(level.id)}
                  disabled={starting}
                  aria-label={level.title}
                  title={level.description ?? undefined}
                >
                  <span className="level-title">
                    <Icon name={level.passed ? "check" : "play"} />
                    {level.title}
                  </span>
                  {level.description && <span className="level-desc">{level.description}</span>}
                  {level.pass_accuracy !== null && (
                    <span className={`level-pass${level.passed ? " done" : ""}`}>
                      {level.passed ? "合格済み" : `合格の目安 正確率 ${Math.round(level.pass_accuracy * 100)}%`}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {stages.length === 0 && !error && <p className="muted">練習できるレベルがありません。教員に追加を依頼してください。</p>}
    </div>
  );
}
