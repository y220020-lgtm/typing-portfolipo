import { useEffect, useState } from "react";

// 苦手克服トレーニングの問題を待つ間の画面（スケルトン）。
// 練習画面と同じ形（見出し・進み具合・出題・入力欄）の灰色の枠を出し、問題が届いたときに画面が跳ねないようにする。
// 下の手順は、サーバーが実際に行う処理（記録の集計 → 苦手の分析 → 問題の作成）。架空の進み具合（%）は出さない。
// 経過時間に合わせて、今の手順を目安として示す（研究室の Qwen では全体で 15 秒ほど。2026-10-23 実測）。
const STEPS = [
  { after: 0, text: "練習の記録を集計しています" },
  { after: 1.5, text: "苦手な文字と指を分析しています" },
  { after: 4, text: "苦手に合わせた問題を作っています" },
];

export function PlaySkeleton() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const t = setInterval(() => setSeconds((Date.now() - started) / 1000), 250);
    return () => clearInterval(t);
  }, []);
  const current = STEPS.filter((s) => seconds >= s.after).length - 1;
  return (
    <div className="card play skeleton" role="status" aria-live="polite" aria-busy="true" aria-label="問題を準備しています">
      <div className="progress">
        <strong>苦手克服トレーニング</strong>
        <span className="sk sk-text" style={{ width: "4.5em" }} />
      </div>
      <div className="progress-bar">
        <span style={{ width: 0 }} />
      </div>
      <div className="target sk-target" aria-hidden="true">
        <span className="sk sk-line" style={{ width: "46%" }} />
      </div>
      <div className="sk sk-input" aria-hidden="true" />
      <ol className="sk-steps">
        {STEPS.map((s, i) => (
          <li key={s.text} className={i < current ? "done" : i === current ? "now" : "todo"}>
            {s.text}
          </li>
        ))}
      </ol>
    </div>
  );
}
