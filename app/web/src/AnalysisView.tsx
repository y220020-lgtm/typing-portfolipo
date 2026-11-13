import type { Analysis } from "./api";
import { BarChart, LineChart } from "./Charts";
import { Icon } from "./Icon";
import { shortDateJst } from "./time";

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const shortDate = shortDateJst;

// 指の表記（keys.finger）を読みやすくする
const FINGER_NAMES: Record<string, string> = { "1": "親指", "2": "人差し指", "3": "中指", "4": "薬指", "5": "小指" };
export function fingerLabel(f: string): string {
  const m = /^([LR])([1-5])$/.exec(f);
  return m ? `${m[1] === "L" ? "左" : "右"}${FINGER_NAMES[m[2]]}（${f}）` : f;
}

// 学習分析の表示（学生本人の画面と、教員の学生詳細で共通）
export function AnalysisView({ analysis }: { analysis: Analysis }) {
  const { total, sessions, chars, fingers } = analysis;
  if (sessions.length === 0) return <p className="muted">まだ練習の記録がありません。</p>;
  const points = sessions.map((s, i) => ({
    label: `${shortDate(s.startedAt)} #${i + 1}`,
    detail: `${s.levelTitle}・${s.questions} 問`,
    value: 0,
    s,
  }));
  const weakChars = chars.filter((c) => c.misses > 0).slice(0, 10);

  return (
    <div>
      <div className="stats">
        <div>
          <span className="value">{sessions.length}</span>
          <span className="label">プレイ回数</span>
        </div>
        <div>
          <span className="value">{total.questions}</span>
          <span className="label">問題数</span>
        </div>
        <div>
          <span className="value">{total.wpm.toFixed(1)}</span>
          <span className="label">平均 WPM</span>
        </div>
        <div>
          <span className="value">{total.cpm.toFixed(0)}</span>
          <span className="label">平均 文字/分</span>
        </div>
        <div>
          <span className="value">{pct(total.accuracy)}</span>
          <span className="label">正確率</span>
        </div>
      </div>

      <h3 className="section-title">
        <Icon name="trend" />
        上達の推移
      </h3>
      <div className="chart-grid">
        <LineChart title="WPM" points={points.map((p) => ({ ...p, value: p.s.wpm }))} format={(v) => v.toFixed(1)} compact />
        <LineChart title="正確率" points={points.map((p) => ({ ...p, value: p.s.accuracy }))} format={pct} max={1} compact />
        {/* 日本語の問題では WPM（5 文字 = 1 語）より 文字/分 の方が分かりやすい */}
        <LineChart title="文字/分" points={points.map((p) => ({ ...p, value: p.s.cpm }))} format={(v) => v.toFixed(0)} compact />
      </div>

      <h3 className="section-title">
        <Icon name="target" />
        苦手の分析
      </h3>

      {weakChars.length > 0 ? (
        <BarChart
          title="間違えやすい文字（ミス率の高い順・上位 10）"
          bars={weakChars.map((c) => ({ label: c.char === " " ? "空白" : c.char, value: c.missRate, note: `${c.misses} / ${c.attempts} 回` }))}
          format={pct}
        />
      ) : (
        <p className="muted">間違えた文字はありません。</p>
      )}
      <BarChart
        title="指ごとのミス率"
        bars={fingers.map((f) => ({ label: fingerLabel(f.finger), value: f.missRate, note: `${f.misses} / ${f.attempts} 回` }))}
        format={pct}
      />
      <p className="muted">
        指はプレイで使ったキーボードのキー設定（keys）から求めています。キーボードを指定しなかったプレイや、キー設定にない文字は「不明」になります。
      </p>

      <h3 className="section-title">
        <Icon name="clock" />
        プレイの一覧
      </h3>
      <table>
        <thead>
          <tr>
            <th>日時</th>
            <th>レベル</th>
            <th>問題数</th>
            <th>WPM</th>
            <th>文字/分</th>
            <th>正確率</th>
          </tr>
        </thead>
        <tbody>
          {[...sessions].reverse().map((s) => (
            <tr key={s.sessionId}>
              <td>{shortDate(s.startedAt)}</td>
              <td>{s.levelTitle}</td>
              <td>{s.questions}</td>
              <td>{s.wpm.toFixed(1)}</td>
              <td>{s.cpm.toFixed(0)}</td>
              <td>{pct(s.accuracy)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
