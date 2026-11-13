import { useEffect, useRef, useState } from "react";
import type { KeyAssign } from "./api";
import { Icon } from "./Icon";
import {
  CAPTURE_STEPS,
  DIGIT_FINGER,
  buttonLabel,
  chordOf,
  conflictOf,
  fingerOfPosition,
  joinFingers,
  judge,
  keyNameOfStep,
  mergeCaptured,
  stepLabel,
  type Chord,
} from "./keyCapture";

const FINGER_NAMES: Record<string, string> = { "1": "親指", "2": "人差し指", "3": "中指", "4": "薬指", "5": "小指" };
const fingerName = (f: string) => `${f[0] === "L" ? "左" : "右"}${FINGER_NAMES[f[1]]}`;
const fingersText = (f: string) => f.split("+").map(fingerName).join(" ＋ ");
// 指のボタン（数字キーの番号つき。キーボードの並びと同じ向き）
const HANDS: { hand: "L" | "R"; fingers: [string, string][] }[] = [
  {
    hand: "L",
    fingers: [
      ["1", "L5"],
      ["2", "L4"],
      ["3", "L3"],
      ["4", "L2"],
      ["5", "L1"],
    ],
  },
  {
    hand: "R",
    fingers: [
      ["6", "R1"],
      ["7", "R2"],
      ["8", "R3"],
      ["9", "R4"],
      ["0", "R5"],
    ],
  },
];

// 「キーを押して登録」（keyCapture.ts）: 文字を決まった順に 1 つずつ出し、その文字に使うボタンを押してもらい、指を選んでもらう。
// ボタンは 1 つでも、同時押し（A と B を一緒に、Ctrl と A を一緒に など、どんな組み合わせでも）でもよい。
// 押したボタンをすべて離した時点で、それまで押していたボタンの組み合わせを 1 つとして受け取る。
// 同じ組み合わせを 2 つの文字に登録しようとしたら止める。
// 終わる（または途中で「ここまでの内容で保存する」）と、結果をいまの割り当てに重ねて onDone に渡す（呼び出し側がすぐ保存する）
export function KeyCapture({ keys, onDone, onCancel }: { keys: KeyAssign[]; onDone: (keys: KeyAssign[]) => void; onCancel: () => void }) {
  const [index, setIndex] = useState(0); // いま登録している文字（CAPTURE_STEPS の番号）
  const [holding, setHolding] = useState<{ code: string; label: string }[]>([]); // 押している途中のボタン（表示用）
  const [chord, setChord] = useState<Chord | null>(null); // 受け取った組み合わせ（次は指を選ぶ）
  const [fingers, setFingers] = useState<(string | null)[]>([]); // ボタンごとの指
  const [active, setActive] = useState(0); // 指を選んでいるボタン
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  // この登録で決めた内容: 文字 → 指（null は「ない」）、組み合わせ → 文字（重なりの確認用）、文字 → 組み合わせ
  const captured = useRef(new Map<string, string | null>());
  const used = useRef(new Map<string, string>());
  const chordOfStep = useRef(new Map<string, Chord>());
  // 押している途中のボタン（keydown で足し、すべて離したら組み合わせにする）
  const held = useRef(new Set<string>());
  const pressedButtons = useRef<{ code: string; label: string }[]>([]);
  const box = useRef<HTMLDivElement>(null);
  const step = CAPTURE_STEPS[index];
  const done = index >= CAPTURE_STEPS.length;
  const registered = [...captured.current].filter(([, f]) => f !== null).length;
  const allChosen = chord !== null && fingers.every((f) => f !== null);

  useEffect(() => box.current?.focus(), [index, chord]);

  function resetPress() {
    held.current.clear();
    pressedButtons.current = [];
    setHolding([]);
    setChord(null);
    setFingers([]);
    setActive(0);
  }
  // 今の文字を登録して次へ（finger が null なら「この文字のキーはない」）
  function record(finger: string | null) {
    const name = keyNameOfStep(step);
    const before = chordOfStep.current.get(name); // やり直しのとき、前に押した組み合わせの記録を消す
    if (before) used.current.delete(before.id);
    chordOfStep.current.delete(name);
    captured.current.set(name, finger);
    if (finger === null) setNotice({ kind: "ok", text: `「${stepLabel(step)}」は登録しませんでした。` });
    else {
      used.current.set(chord!.id, step);
      chordOfStep.current.set(name, chord!);
      setNotice({ kind: "ok", text: `「${stepLabel(step)}」に ${chord!.label}（${fingersText(finger)}）を登録しました。` });
    }
    resetPress();
    setIndex(index + 1);
  }
  // ボタン（active）の指を決める。ボタンが 1 つならすぐ登録。同時押しなら次のボタンへ進み、全部決めたら「この内容で登録する」か Enter
  function chooseFinger(f: string) {
    const next = fingers.map((x, i) => (i === active ? f : x));
    if (next.length === 1) return record(f);
    setFingers(next);
    const rest = next.findIndex((x) => x === null);
    setActive(rest === -1 ? (active + 1) % next.length : rest);
  }
  function back() {
    if (index === 0) return;
    const prev = keyNameOfStep(CAPTURE_STEPS[index - 1]);
    const c = chordOfStep.current.get(prev);
    if (c) used.current.delete(c.id);
    chordOfStep.current.delete(prev);
    captured.current.delete(prev);
    resetPress();
    setNotice({ kind: "ok", text: `「${stepLabel(CAPTURE_STEPS[index - 1])}」に戻りました。もう一度ボタンを押してください。` });
    setIndex(index - 1);
  }
  function finish() {
    onDone(mergeCaptured(keys, captured.current));
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (done) return;
    // Tab・Space・Enter・Backspace・Alt などの本来の動き（画面の移動・スクロール・メニュー）を止める
    e.preventDefault();
    if (e.repeat) return;
    if (chord) {
      // 指を選ぶ段階: 数字キーでいまのボタンの指、Enter で決定（全部決まっていれば）、Esc で押し直し
      const digit = /^Digit(\d)$/.exec(e.nativeEvent.code)?.[1];
      if (digit) chooseFinger(DIGIT_FINGER[digit]);
      else if (e.key === "Enter" && allChosen) record(joinFingers(fingers as string[]));
      else if (e.key === "Escape") resetPress();
      return;
    }
    // 何も押していないときの Esc は「この文字はない」
    if (e.key === "Escape" && held.current.size === 0) return record(null);
    const r = judge(e.nativeEvent);
    if (r === "ime") return setNotice({ kind: "error", text: "日本語入力がオンになっています。オフにしてから、もう一度押してください。" });
    if (r === "ignore") return;
    const code = e.nativeEvent.code || e.key;
    if (held.current.has(code)) return;
    held.current.add(code);
    if (!pressedButtons.current.some((b) => b.code === code)) pressedButtons.current.push({ code, label: buttonLabel(code, e.key) });
    setHolding([...pressedButtons.current]);
  }
  function onKeyUp(e: React.KeyboardEvent) {
    if (done || chord) return;
    e.preventDefault();
    held.current.delete(e.nativeEvent.code || e.key);
    if (held.current.size > 0 || pressedButtons.current.length === 0) return;
    // すべて離した: それまで押していたボタンの組み合わせを受け取る
    const c = chordOf(pressedButtons.current);
    const other = conflictOf(used.current, c, step);
    if (other !== null) {
      resetPress();
      return setNotice({
        kind: "error",
        text:
          `${c.label} は、すでに「${stepLabel(other)}」に登録しています。1 つのボタン（組み合わせ）に 2 つの文字は登録できません。` +
          `別のボタンを押すか、ほかのボタンと一緒に押して（同時押し）登録してください。「${stepLabel(other)}」を登録し直す場合は「1 つ前に戻る」を使ってください。`,
      });
    }
    const guess = c.buttons.map((b) => fingerOfPosition(b.code));
    setChord(c);
    setFingers(guess);
    setActive(
      Math.max(
        0,
        guess.findIndex((g) => g === null),
      ),
    );
    setNotice(null);
  }

  return (
    <div className="key-capture" ref={box} tabIndex={0} onKeyDown={onKeyDown} onKeyUp={onKeyUp} role="group" aria-label="キーを押して登録">
      <div className="key-capture-progress" aria-hidden="true">
        <span style={{ width: `${(Math.min(index, CAPTURE_STEPS.length) / CAPTURE_STEPS.length) * 100}%` }} />
      </div>
      {done ? (
        <div className="key-capture-step">
          <p>
            すべての文字が終わりました（{registered} 個を登録、{CAPTURE_STEPS.length - registered} 個はなし）。
          </p>
          <div className="row-actions">
            <button onClick={finish}>
              <Icon name="check" />
              登録を保存する
            </button>
            <button className="secondary" onClick={back}>
              1 つ前に戻る
            </button>
          </div>
        </div>
      ) : (
        <div className="key-capture-step">
          <p className="muted">
            {index + 1} / {CAPTURE_STEPS.length}（登録済み {registered}{" "}
            個）　この枠をクリックしてからボタンを押してください。日本語入力はオフにしてください。
          </p>
          <div className="key-capture-target">
            <div className={`key-capture-char${chord ? " ok" : ""}`} aria-live="polite">
              {stepLabel(step)}
            </div>
            {(chord || holding.length > 0) && (
              <>
                <span className="key-capture-arrow" aria-hidden="true">
                  ←
                </span>
                <div className="key-capture-pressed">{chord ? chord.label : holding.map((b) => b.label).join(" + ")}</div>
              </>
            )}
          </div>
          {!chord ? (
            <p>
              「{stepLabel(step)}」を打つときに使うボタンを押して、離してください。どのボタンでも、押したボタンが「{stepLabel(step)}」になります。
              <br />
              <span className="muted">
                同時押し（例: A と B を一緒に）にするときは、ボタンを全部押してから離してください。ない場合は Esc キーか「「{stepLabel(step)}
                」のキーはない」を押してください。
              </span>
            </p>
          ) : (
            <>
              <p>
                {chord.label} を「{stepLabel(step)}」として登録します。
                {chord.buttons.length > 1 ? "ボタンごとに、押す指を選んでください。" : "押す指を選んでください。"}
                <br />
                <span className="muted">
                  {allChosen ? `Enter キーで「${fingersText(joinFingers(fingers as string[]))}」に決まります。` : ""}数字キーの 1〜0 でも選べます。
                </span>
              </p>
              {chord.buttons.length > 1 && (
                <div className="key-capture-buttons" role="tablist" aria-label="指を選ぶボタン">
                  {chord.buttons.map((b, i) => (
                    <button
                      key={b.code}
                      role="tab"
                      aria-selected={i === active}
                      className={i === active ? "" : "secondary"}
                      onClick={() => setActive(i)}
                    >
                      {b.label}：{fingers[i] ? fingerName(fingers[i]!) : "未選択"}
                    </button>
                  ))}
                </div>
              )}
              <div className="key-capture-hands">
                {HANDS.map((h) => (
                  <div key={h.hand} className="key-capture-hand" aria-label={h.hand === "L" ? "左手" : "右手"}>
                    {h.fingers.map(([digit, f]) => (
                      <button
                        key={f}
                        className={`${f === fingers[active] ? "" : "secondary "}finger-btn f${f[1]}`}
                        onClick={() => chooseFinger(f)}
                        title={`${f}（数字キー ${digit}）`}
                      >
                        <span className="finger-digit">{digit}</span>
                        {fingerName(f)}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
              {allChosen && (
                <div className="row-actions">
                  <button onClick={() => record(joinFingers(fingers as string[]))}>
                    <Icon name="check" />
                    この内容で登録する
                  </button>
                </div>
              )}
            </>
          )}
          {notice && (
            <p className={notice.kind === "error" ? "error" : "pass-note"} role={notice.kind === "error" ? "alert" : "status"}>
              <Icon name={notice.kind === "error" ? "alert" : "check"} />
              {notice.text}
            </p>
          )}
          <div className="row-actions">
            {chord ? (
              <button className="secondary" onClick={resetPress}>
                押し直す
              </button>
            ) : (
              <button className="secondary" onClick={() => record(null)}>
                「{stepLabel(step)}」のキーはない
              </button>
            )}
            <button className="secondary" onClick={back} disabled={index === 0}>
              1 つ前に戻る
            </button>
            <button className="secondary" onClick={finish}>
              ここまでの内容で保存する
            </button>
            <button className="link" onClick={onCancel}>
              保存せずにやめる
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
