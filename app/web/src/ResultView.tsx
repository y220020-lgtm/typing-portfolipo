import { useEffect, useState } from "react";
import { api, type Result } from "./api";
import { Icon } from "./Icon";

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

type Question = Result["questions"][number];

// 出題の側: 打ち間違えた文字と、打たなかった（足りない）文字に印を付ける
function TargetMarked({ q }: { q: Question }) {
  const missed = new Set(q.mistakes.map((m) => m.index));
  return (
    <>
      {Array.from(q.target).map((ch, i) => (
        <span key={i} className={missed.has(i) ? "ng" : undefined}>
          {ch === " " ? "␣" : ch}
        </span>
      ))}
    </>
  );
}

// 入力の側: 出題と違う文字と、出題より多く打った文字に印を付ける
function TypedMarked({ q }: { q: Question }) {
  const missed = new Set(q.mistakes.map((m) => m.index));
  const targetLen = Array.from(q.target).length;
  const typed = Array.from(q.typed);
  if (typed.length === 0) return <span className="muted">（入力なし）</span>;
  return (
    <>
      {typed.map((ch, i) => (
        <span key={i} className={missed.has(i) || i >= targetLen ? "ng" : undefined}>
          {ch === " " ? "␣" : ch}
        </span>
      ))}
    </>
  );
}

export function ResultView({
  sessionId,
  levelTitle,
  onBack,
  onNextTraining,
  onLevelTraining,
  onPlayLevel,
}: {
  sessionId: string;
  levelTitle: string;
  onBack: () => void;
  onPlayLevel?: (levelId: number, retryOf?: string) => void; // 間違えた問題だけをもう一度・次のレベルへ（通常のレベルのとき）
  onNextTraining?: () => void; // 苦手克服トレーニングのときだけ（待ちの画面と問題の取得は App が行う）
  onLevelTraining?: (levelId: number) => void; // 通常のレベルのとき: このレベルの範囲で苦手を補う問題へ
}) {
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .result(sessionId)
      .then(setResult)
      .catch((e) => setError(e.message));
  }, [sessionId]);

  if (error)
    return (
      <p className="error" role="alert">
        <Icon name="alert" />
        {error}
      </p>
    );
  if (!result) return <p className="muted">集計しています…</p>;
  const s = result.summary;
  const perfect = result.questions.filter((q) => q.accuracy === 1).length;
  const pct0 = (x: number) => `${Math.round(x * 100)}%`;

  return (
    <div className="card">
      <div className="card-header">
        <h2>結果：{levelTitle}</h2>
        <span className="badge">
          <Icon name="check" />
          全問正解 {perfect} / {result.questions.length} 問
        </span>
      </div>
      {/* 合格の目安があるレベルだけ、合格したかを出す（目安のないレベルは自由に練習） */}
      {result.passAccuracy !== null && (
        <p className={result.passed ? "ok-message" : "pass-note"} role="status">
          <Icon name={result.passed ? "check" : "target"} />
          {result.passed
            ? `合格です（合格の目安: 10 問すべて解いて正確率 ${pct0(result.passAccuracy)} 以上）`
            : `合格の目安は、10 問すべて解いて正確率 ${pct0(result.passAccuracy)} 以上です。`}
        </p>
      )}
      <div className="result-head">
        <div
          className="ring"
          style={{ "--p": (s.accuracy * 100).toFixed(1) } as React.CSSProperties}
          role="img"
          aria-label={`正確率 ${pct(s.accuracy)}`}
        >
          <span>{Math.round(s.accuracy * 100)}%</span>
        </div>
        <div className="stats">
          <div className="accent">
            {/* 日本語の問題が中心なら 文字/分、英字なら WPM を主に出す */}
            <span className="value">{s.japanese ? s.cpm.toFixed(0) : s.wpm.toFixed(1)}</span>
            <span className="label">{s.japanese ? "文字/分" : "WPM"}</span>
          </div>
          <div>
            <span className="value">{pct(s.accuracy)}</span>
            <span className="label">正確率</span>
          </div>
          <div>
            <span className="value">{s.seconds.toFixed(1)} 秒</span>
            <span className="label">合計時間</span>
          </div>
        </div>
      </div>
      <h3>問題ごとの結果</h3>
      <div className="table-scroll">
        <table className="result-table">
          <thead>
            <tr>
              <th>問</th>
              <th>出題</th>
              <th>入力</th>
              <th>正確率</th>
              <th>時間</th>
            </tr>
          </thead>
          <tbody>
            {result.questions.map((q) => (
              <tr key={q.questionNum} className={q.accuracy < 1 ? "has-miss" : undefined}>
                <td>{q.questionNum}</td>
                <td className={q.japanese ? undefined : "mono"}>
                  <TargetMarked q={q} />
                </td>
                <td className={q.japanese ? undefined : "mono"}>
                  <TypedMarked q={q} />
                </td>
                <td>{pct(q.accuracy)}</td>
                <td>{q.seconds.toFixed(1)} 秒</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted">
        赤い下線は、打ち間違えた文字・打たなかった文字・多く打った文字です。␣ は空白（スペース）です。
        {s.japanese
          ? "文字/分 は、正しく打てた文字数を 1 分あたりに換算した値です（日本語は変換した後の文字で数えます）。"
          : "WPM は正しく打てた文字数を 5 文字 = 1 語として 1 分あたりに換算した値です。"}
      </p>
      <div className="row-actions">
        {onNextTraining && (
          <button className="lg" onClick={onNextTraining}>
            <Icon name="target" />
            苦手に合わせた次の問題へ
          </button>
        )}
        {onLevelTraining && result.levelId !== null && (
          <button className="lg" onClick={() => onLevelTraining(result.levelId!)}>
            <Icon name="target" />
            このレベルの苦手を克服する問題へ
          </button>
        )}
        {onPlayLevel && result.levelId !== null && perfect < result.questions.length && (
          <button className="secondary" onClick={() => onPlayLevel(result.levelId!, sessionId)}>
            <Icon name="target" />
            間違えた問題だけもう一度（{result.questions.length - perfect} 問）
          </button>
        )}
        {onPlayLevel && result.nextLevel && (result.passed || result.passAccuracy === null) && (
          <button onClick={() => onPlayLevel(result.nextLevel!.id)}>
            <Icon name="play" />
            次のレベルへ：{result.nextLevel.title}
          </button>
        )}
        <button className={onNextTraining || onPlayLevel || onLevelTraining ? "secondary" : undefined} onClick={onBack}>
          <Icon name="back" />
          レベル選択に戻る
        </button>
      </div>
    </div>
  );
}
