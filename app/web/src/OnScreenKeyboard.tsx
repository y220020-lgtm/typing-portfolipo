// 画面のキーボード: 次に打つキーと、担当の指を光らせる。
// キーの並びは、選んだキーボードの並び（keyboards.layout: JIS・US・Keyball44）で描く。
// 自由な配列（free）は、組み替えたキーボードやキーの少ないキーボードのためのもので、登録したキー（keys）を担当の指ごとに並べて描く。
// 担当の指は、このプレイで選んだキーボードの keys（学生の設定）から決める。割り当てのないキーは指を出さない。
import { keyNameOf } from "../../shared/analysis";

export type Layout = "jis" | "us" | "keyball44" | "free";
export const LAYOUT_NAMES: Record<Layout, string> = {
  jis: "JIS 配列",
  us: "US 配列",
  keyball44: "Keyball44（左右分割）",
  free: "自由な配列（キーを指ごとに表示）",
};
// 並びごとの文字の段。split は左右に分かれたキーボード（Keyball44: 片手 3 段 × 6 列。左右の端の列は Tab・Ctrl・Shift などで文字なし）
const LAYOUTS: Record<Exclude<Layout, "free">, { rows: string[][]; indent: number[]; split: boolean; shifted: Record<string, string> }> = {
  jis: {
    rows: [
      ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "-", "^", "¥"],
      ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p", "@", "["],
      ["a", "s", "d", "f", "g", "h", "j", "k", "l", ";", ":", "]"],
      ["z", "x", "c", "v", "b", "n", "m", ",", ".", "/", "\\"],
    ],
    indent: [0, 0.5, 0.75, 1.25],
    split: false,
    shifted: {
      "!": "1",
      '"': "2",
      "#": "3",
      $: "4",
      "%": "5",
      "&": "6",
      "'": "7",
      "(": "8",
      ")": "9",
      "=": "-",
      "~": "^",
      "|": "¥",
      "`": "@",
      "{": "[",
      "+": ";",
      "*": ":",
      "}": "]",
      "<": ",",
      ">": ".",
      "?": "/",
      _: "\\",
    },
  },
  us: {
    rows: [
      ["`", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "-", "="],
      ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p", "[", "]", "\\"],
      ["a", "s", "d", "f", "g", "h", "j", "k", "l", ";", "'"],
      ["z", "x", "c", "v", "b", "n", "m", ",", ".", "/"],
    ],
    indent: [0, 0.5, 0.75, 1.25],
    split: false,
    shifted: {
      "~": "`",
      "!": "1",
      "@": "2",
      "#": "3",
      $: "4",
      "%": "5",
      "^": "6",
      "&": "7",
      "*": "8",
      "(": "9",
      ")": "0",
      _: "-",
      "+": "=",
      "{": "[",
      "}": "]",
      "|": "\\",
      ":": ";",
      '"': "'",
      "<": ",",
      ">": ".",
      "?": "/",
    },
  },
  keyball44: {
    // 左手 6 列 + 右手 6 列（端の列は文字なし＝空）。数字はレイヤーで打つため段を持たない
    rows: [
      ["", "q", "w", "e", "r", "t", "y", "u", "i", "o", "p", ""],
      ["", "a", "s", "d", "f", "g", "h", "j", "k", "l", ";", ""],
      ["", "z", "x", "c", "v", "b", "n", "m", ",", ".", "/", ""],
    ],
    indent: [0, 0, 0],
    split: true,
    shifted: { "<": ",", ">": ".", "?": "/", "+": ";" },
  },
};
const FINGER_NAMES: Record<string, string> = { "1": "親指", "2": "人差し指", "3": "中指", "4": "薬指", "5": "小指" };
export const fingerLabel = (f: string) => {
  const m = /^([LR])([1-5])/.exec(f);
  return m ? `${m[1] === "L" ? "左" : "右"}${FINGER_NAMES[m[2]]}` : "";
};

// 次に打つ文字から、光らせるキーと Shift が要るかを決める（英大文字と記号の一部は Shift）
export function keyFor(ch: string | undefined, layout: Exclude<Layout, "free"> = "jis"): { key: string | null; shift: boolean } {
  const L = LAYOUTS[layout];
  if (ch === undefined) return { key: null, shift: false };
  if (ch === " ") return { key: " ", shift: false };
  if (/^[A-Z]$/.test(ch)) return { key: ch.toLowerCase(), shift: true };
  if (L.rows.some((r) => r.includes(ch))) return { key: ch, shift: false };
  if (L.shifted[ch]) return { key: L.shifted[ch], shift: true };
  return { key: null, shift: false };
}

export function OnScreenKeyboard({
  next,
  keys,
  layout = "jis",
  kana,
}: {
  next: string | undefined; // 次に押すキーの文字（日本語の問題では、ローマ字の最初の文字）
  keys: { char: string; finger: string }[];
  layout?: Layout;
  // 日本語の問題のとき: 次に打つかなとローマ字（漢字など読みが決まらないときは reading: null）
  kana?: { text: string; romaji: string | null };
}) {
  const fingerOf = new Map(keys.map((k) => [k.char, k.finger]));
  const free = layout === "free";
  const L = free ? null : (LAYOUTS[layout as Exclude<Layout, "free">] ?? LAYOUTS.jis);
  // 自由な配列: 登録したキーの名前で探す（英大文字は Shift と同じキー）
  const { key, shift } = free
    ? next === undefined || !fingerOf.has(keyNameOf(next))
      ? { key: null, shift: false }
      : { key: keyNameOf(next), shift: /^[A-Z]$/.test(next) }
    : keyFor(next, layout as Exclude<Layout, "free">);
  const finger = key === null ? undefined : fingerOf.get(free ? key : keyNameOf(key));
  const hand = finger?.slice(0, 1);
  const num = finger ? Number(finger.slice(1, 2)) : 0;
  return (
    <figure className="osk" aria-label="次に打つキー">
      {free ? (
        <FreeBoard keys={keys} on={key} />
      ) : (
        <div className={`osk-board${L!.split ? " split" : ""}`} aria-hidden="true" data-layout={layout}>
          {L!.rows.map((row, r) => (
            <div key={r} className="osk-row" style={{ paddingLeft: `calc(var(--osk-key) * ${L!.indent[r]})` }}>
              {row.map((k, i) => (
                <span
                  key={`${r}:${i}`}
                  className={`osk-key${k === "" ? " blank" : ""}${k !== "" && k === key ? " on" : ""}${k === "f" || k === "j" ? " home" : ""}${L!.split && i === row.length / 2 ? " gap" : ""}`}
                >
                  {k.toUpperCase()}
                </span>
              ))}
            </div>
          ))}
          <div className="osk-row osk-bottom">
            <span className={`osk-key osk-shift${shift ? " on" : ""}`}>Shift</span>
            <span className={`osk-key osk-space${key === " " ? " on" : ""}`}>スペース</span>
          </div>
        </div>
      )}
      <div className="osk-hands" aria-hidden="true">
        {(["L", "R"] as const).map((h) => (
          <div key={h} className={`osk-hand osk-hand-${h}`}>
            {(h === "L" ? [5, 4, 3, 2, 1] : [1, 2, 3, 4, 5]).map((n) => (
              <span key={n} className={`osk-finger f${n}${hand === h && num === n ? " on" : ""}`} />
            ))}
          </div>
        ))}
      </div>
      <figcaption className="muted">
        {kana ? (
          kana.romaji === null ? (
            `次は「${kana.text}」：読みをローマ字で入力して変換します`
          ) : (
            <>
              次は「{kana.text}」＝ <span className="osk-romaji">{kana.romaji}</span>
              {key !== null && finger ? `（最初の「${next}」：${fingerLabel(finger)}・${finger}）` : ""}
            </>
          )
        ) : next === undefined ? (
          "すべて打ちました"
        ) : key === null ? (
          "このキーは画面のキーボードにありません"
        ) : (
          `次は「${next === " " ? "スペース" : next}」${shift ? "（Shift を押しながら）" : ""}${finger ? `：${fingerLabel(finger)}（${finger}）` : "：指の割り当てなし（キーボードの設定で決められます）"}`
        )}
      </figcaption>
    </figure>
  );
}

// 自由な配列: 登録したキーを、担当の指の列（左小指〜左親指・右親指〜右小指）に並べる。
// 同時押し（L5+L2 など）のキーは、最初の指の列に「+」を付けて出す
const FREE_COLUMNS = ["L5", "L4", "L3", "L2", "L1", "R1", "R2", "R3", "R4", "R5"];
const SHOWN: Record<string, string> = { KC_SCLN: ";", KC_SLSH: "/", Space: "␣" };
function FreeBoard({ keys, on }: { keys: { char: string; finger: string }[]; on: string | null }) {
  return (
    <div className="osk-free" aria-hidden="true" data-layout="free">
      {FREE_COLUMNS.map((f) => {
        const col = keys.filter((k) => k.finger.slice(0, 2) === f);
        return (
          <div key={f} className={`osk-free-col${f === "R1" ? " gap" : ""}`}>
            <span className="osk-free-head">{fingerLabel(f)}</span>
            {col.map((k) => (
              <span key={k.char} className={`osk-key osk-free-key${k.char === on ? " on" : ""}`} title={k.finger}>
                {SHOWN[k.char] ?? k.char}
                {k.finger.includes("+") ? "+" : ""}
              </span>
            ))}
          </div>
        );
      })}
    </div>
  );
}
