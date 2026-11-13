import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ApiError, api, type Session } from "./api";
import { Icon } from "./Icon";
import { OnScreenKeyboard } from "./OnScreenKeyboard";
import { nextSyllable } from "./romaji";
import { scoreSession } from "../../shared/score";

// 1 問ごとに: 問題が表示された時刻 = start_time、Enter を押した時刻 = end_time。
// typed には Enter を押した時点で入力欄に残っている文字列を記録する（Backspace で消した文字は含まない）。
// 時刻は、プレイ開始時にサーバーから受け取った時刻との差で補正する（端末の時計がずれていても記録がずれないように）。
export function Play({ session, onFinish, onQuit }: { session: Session; onFinish: () => void; onQuit: () => void }) {
  const [index, setIndex] = useState(0);
  const [typed, setTyped] = useState("");
  // 日本語入力（IME）で変換している間の、確定済みの部分。変換中の文字（「sa」や「さ」）は色付けに使わない
  const [committed, setCommitted] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [fatal, setFatal] = useState(false); // これ以上記録できない（プレイの期限切れ・レベル削除など）
  const offset = useRef(session.receivedAt !== undefined ? Date.parse(session.serverTime) - session.receivedAt : 0);
  const nowIso = () => new Date(Date.now() + offset.current).toISOString();
  const startTime = useRef(nowIso());
  const busy = useRef(false); // Enter の連打で 2 回送らないよう、state ではなく ref で即座に止める
  const input = useRef<HTMLInputElement>(null);

  const target = session.questions[index];
  // 打っている最中の成績: ここまでに保存した問題（done）と、今の問題を今の入力で採点した値（結果画面と同じ計算）
  const done = useRef<{ target: string; typed: string; start_time: string; end_time: string }[]>([]);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, []);
  void tick;
  const typedChars = Array.from(committed ?? typed);
  // 今の問題は、まだ打っていない文字をミスに数えないよう、打った文字数までの出題と比べる
  const typedSoFar = Array.from(target).slice(0, Math.max(typedChars.length, 1)).join("");
  const live = scoreSession([...done.current, { target: typedSoFar, typed: committed ?? typed, start_time: startTime.current, end_time: nowIso() }]);
  const nextChar = typedChars.length < Array.from(target).length ? Array.from(target)[typedChars.length] : undefined;
  // 日本語の問題: 入力欄には変換して確定した文字だけが入るので、出題と同じところまでを「打った」とみなし、
  // 次のかなとそのローマ字を案内する（漢字は読みが決まらないので、ローマ字は出さない）
  const japanese = /[^\x20-\x7e]/.test(target);
  const targetChars = Array.from(target);
  let matched = 0;
  while (matched < typedChars.length && matched < targetChars.length && typedChars[matched] === targetChars[matched]) matched++;
  const syllable = japanese && matched < targetChars.length ? nextSyllable(target, matched) : null;
  const kanaGuide =
    japanese && matched < targetChars.length ? { text: syllable?.kana ?? targetChars[matched], romaji: syllable?.romaji ?? null } : undefined;
  const keyNext = japanese ? syllable?.romaji[0] : nextChar;

  useEffect(() => {
    startTime.current = nowIso();
    input.current?.focus();
  }, [index]);

  async function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    // 日本語入力の変換確定の Enter は次の問題へ進む操作として扱わない
    if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
    e.preventDefault();
    if (busy.current || fatal) return;
    busy.current = true;
    const endTime = nowIso();
    setSaving(true);
    setError("");
    try {
      await api.saveLog({
        sessionId: session.sessionId,
        questionNum: index + 1,
        typed,
        startTime: startTime.current,
        endTime,
      });
      done.current.push({ target, typed, start_time: startTime.current, end_time: endTime });
      if (index + 1 >= session.questions.length) {
        onFinish();
      } else {
        setTyped("");
        setCommitted(null);
        setIndex(index + 1);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (err instanceof ApiError && (err.status === 404 || err.status === 409 || err.status === 401)) {
        // やり直しても保存できない場合
        setFatal(true);
        setError(`${msg}（ここまでの記録は保存済みです）`);
      } else {
        // 通信の失敗など: 同じ問題にとどまる（入力は残す）
        setError(`保存できませんでした: ${msg}。もう一度 Enter を押してください。`);
      }
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  return (
    <div className="card play">
      <div className="progress">
        <strong>{session.level.title}</strong>
        <span>
          {index + 1} / {session.questions.length} 問
        </span>
      </div>
      <div
        className="progress-bar"
        role="progressbar"
        aria-label="進み具合"
        aria-valuemin={0}
        aria-valuemax={session.questions.length}
        aria-valuenow={index}
      >
        <span style={{ width: `${(index / session.questions.length) * 100}%` }} />
      </div>
      <div className={`target${/[^\x20-\x7e]/.test(target) ? " target-ja" : ""}`} aria-label="出題" data-text={target}>
        {Array.from(target).map((ch, i) => {
          const t = Array.from(committed ?? typed);
          // 次に打つ文字には「cur」（光るカーソル）。直前に打った文字には「just」（短い光）
          const cls = i >= t.length ? (i === t.length ? "pending cur" : "pending") : t[i] === ch ? (i === t.length - 1 ? "ok just" : "ok") : "ng";
          // 空白は見えないので「␣」で示す（打つのは今までどおり半角スペース。判定と記録は元の文字のまま）
          return (
            <span key={i} className={ch === " " ? `${cls} space` : cls}>
              {ch === " " ? "␣" : ch}
            </span>
          );
        })}
      </div>
      <input
        ref={input}
        className="typing"
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        onCompositionStart={(e) => setCommitted(e.currentTarget.value)}
        onCompositionEnd={() => setCommitted(null)}
        readOnly={saving || fatal}
        onKeyDown={onKeyDown}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        aria-label="入力"
      />
      {error && (
        <p className="error" role="alert">
          <Icon name="alert" />
          {error}
        </p>
      )}
      {fatal && <button onClick={onQuit}>レベル選択に戻る</button>}
      {/* 出題より多く打った文字は、出題の側に印が付かないので、入力欄の下で知らせる */}
      {typedChars.length > targetChars.length && (
        <p className="extra-note" role="status">
          出題より {typedChars.length - targetChars.length} 文字多く打っています（「{typedChars.slice(targetChars.length).join("")}」）。Backspace
          で消せます。
        </p>
      )}
      <dl className="live-stats" aria-label="ここまでの成績">
        <div>
          <dt>{live.japanese ? "文字/分" : "WPM"}</dt>
          {/* 始めてすぐは時間が短すぎて値が大きく振れるので、1 秒たつまで出さない */}
          <dd>{live.seconds < 1 ? "—" : live.japanese ? live.cpm.toFixed(0) : live.wpm.toFixed(1)}</dd>
        </div>
        <div>
          <dt>正確率</dt>
          <dd>{(live.accuracy * 100).toFixed(1)}%</dd>
        </div>
        <div>
          <dt>時間</dt>
          <dd>{live.seconds.toFixed(0)} 秒</dd>
        </div>
      </dl>
      {/* 日本語の問題は、次のかなのローマ字と、その最初のキーを案内する（採点は変換した後の文字のまま） */}
      <OnScreenKeyboard next={keyNext} keys={session.keys ?? []} layout={session.layout ?? "jis"} kana={kanaGuide} />
      <div className="play-hint">
        <p className="muted">
          打ち終わったら <kbd>Enter</kbd> で次の問題へ進みます。
        </p>
        <button className="link" onClick={onQuit}>
          やめる（ここまでの記録は保存済み）
        </button>
      </div>
      {/* 苦手の分析は補助の情報なので、問題・入力欄・操作の案内の後に置く */}
      {session.analysis && (
        <p className="analysis-note">
          <Icon name="target" />
          <span>
            <strong>今回の重点:</strong> {session.analysis}
          </span>
        </p>
      )}
    </div>
  );
}
