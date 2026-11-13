// 外部ライブラリを使わない、単一系列の SVG グラフ（折れ線・横棒）。
// 色は 1 系列なので 1 色（検証済み: 白背景でコントラスト 3:1 以上）。値は文字色で書く。
import { useId, useState } from "react";

export interface Point {
  label: string; // 横軸の表示（例: 10/16 #3）
  value: number;
  detail?: string; // ホバー時に追加で出す説明
}

// 狭い枠（2 列に並べるとき）は、同じ画面の幅でも文字が小さくなりすぎないよう、描く大きさを小さくする
const SIZE = { wide: { W: 640, H: 220 }, compact: { W: 360, H: 200 } };
const PAD = { top: 16, right: 16, bottom: 28, left: 48 };

export function LineChart({
  title,
  points,
  format,
  max,
  compact,
}: {
  title: string;
  points: Point[];
  format: (v: number) => string;
  max?: number; // 縦軸の上限（正確率なら 1）
  compact?: boolean; // 2 列に並べるなど、狭い枠に置くとき
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const gid = useId().replace(/:/g, ""); // グラデーションの id（同じ画面に複数のグラフがあっても重ならないように）
  if (points.length === 0) return null;

  const top = max ?? niceMax(Math.max(...points.map((p) => p.value)));
  const { W, H } = compact ? SIZE.compact : SIZE.wide;
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (points.length === 1 ? innerW / 2 : (innerW * i) / (points.length - 1));
  const y = (v: number) => PAD.top + innerH - (innerH * v) / (top || 1);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * top);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p.value)}`).join(" ");
  const last = points.length - 1;
  // 線の下の面（見やすさのための塗り。値は線と同じ）
  const area = `${path} L${x(last)},${PAD.top + innerH} L${x(0)},${PAD.top + innerH} Z`;
  const step = points.length > 1 ? innerW / (points.length - 1) : innerW;

  return (
    <figure className="chart">
      <figcaption>
        <span>{title}</span>
        <button className="link" onClick={() => setAsTable(!asTable)}>
          {asTable ? "グラフで見る" : "表で見る"}
        </button>
      </figcaption>
      {asTable ? (
        <DataTable rows={points.map((p) => [p.label, format(p.value)])} head={["プレイ", title]} />
      ) : (
        <div className="chart-box">
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}の推移`} onMouseLeave={() => setHover(null)}>
            <defs>
              <linearGradient id={`line-${gid}`} x1="0" x2="1" y1="0" y2="0">
                <stop offset="0%" className="grad-a" />
                <stop offset="100%" className="grad-b" />
              </linearGradient>
              <linearGradient id={`area-${gid}`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" className="area-a" />
                <stop offset="100%" className="area-b" />
              </linearGradient>
            </defs>
            {ticks.map((t) => (
              <g key={t}>
                <line className="grid" x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} />
                <text className="axis" x={PAD.left - 6} y={y(t)} textAnchor="end" dominantBaseline="middle">
                  {format(t)}
                </text>
              </g>
            ))}
            <text className="axis" x={x(0)} y={H - 8} textAnchor={points.length === 1 ? "middle" : "start"}>
              {points[0].label}
            </text>
            {last > 0 && (
              <text className="axis" x={x(last)} y={H - 8} textAnchor="end">
                {points[last].label}
              </text>
            )}
            {hover !== null && <line className="crosshair" x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + innerH} />}
            {points.length > 1 && <path className="series-area" d={area} fill={`url(#area-${gid})`} />}
            <path className="series-line" d={path} stroke={`url(#line-${gid})`} />
            {points.map((p, i) => (
              <circle key={i} className="series-dot" cx={x(i)} cy={y(p.value)} r={hover === i ? 5 : 4} />
            ))}
            {/* 最新の値だけ直接ラベルを付ける */}
            <text className="value-label" x={x(last)} y={y(points[last].value) - 10} textAnchor={last > 0 ? "end" : "middle"}>
              {format(points[last].value)}
            </text>
            {/* 当たり判定は点より広く取る */}
            {points.map((_, i) => (
              <rect key={i} x={x(i) - step / 2} y={PAD.top} width={step} height={innerH} fill="transparent" onMouseEnter={() => setHover(i)} />
            ))}
          </svg>
          {hover !== null && (
            <div className="tooltip" style={{ left: `${(x(hover) / W) * 100}%` }}>
              <strong>{format(points[hover].value)}</strong>
              <span>{points[hover].label}</span>
              {points[hover].detail && <span>{points[hover].detail}</span>}
            </div>
          )}
        </div>
      )}
    </figure>
  );
}

export interface Bar {
  label: string;
  value: number; // 0〜1（ミス率）
  note: string; // 例: 3 / 12 回
}

export function BarChart({ title, bars, format }: { title: string; bars: Bar[]; format: (v: number) => string }) {
  const [asTable, setAsTable] = useState(false);
  if (bars.length === 0) return null;
  const top = Math.max(...bars.map((b) => b.value), 0.0001);
  return (
    <figure className="chart">
      <figcaption>
        <span>{title}</span>
        <button className="link" onClick={() => setAsTable(!asTable)}>
          {asTable ? "グラフで見る" : "表で見る"}
        </button>
      </figcaption>
      {asTable ? (
        <DataTable rows={bars.map((b) => [b.label, format(b.value), b.note])} head={["", "ミス率", "回数"]} />
      ) : (
        <ul className="bars">
          {bars.map((b) => (
            <li key={b.label} title={`${b.label}: ${format(b.value)}（${b.note}）`}>
              <span className="bar-label mono">{b.label}</span>
              <span className="bar-track">
                <span className="bar-fill" style={{ width: `${(b.value / top) * 100}%` }} />
              </span>
              <span className="bar-value">
                {format(b.value)} <span className="muted">（{b.note}）</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </figure>
  );
}

function DataTable({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <table>
      <thead>
        <tr>
          {head.map((h, i) => (
            <th key={i}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            {r.map((c, j) => (
              <td key={j}>{c}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}
