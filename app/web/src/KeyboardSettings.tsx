import { useEffect, useState } from "react";
import { api, keyboardChoice, type KeyAssign, type KeyboardSettings as Settings } from "./api";
import { Icon } from "./Icon";
import { KeyCapture } from "./KeyCapture";
import { LAYOUT_NAMES, type Layout } from "./OnScreenKeyboard";

// 学生のキーボードの設定（データベース仕様書 ④ keyboards・⑤ keys）。
// キーボードの追加（ひな形: Keyball44・JIS・US・空、または自分のキーボードの写し）・名前の変更・削除と、キーと指の割り当ての編集。
// どんなキーボードも登録できるよう、キーは自由に追加・外せる（キーの少ないキーボード・組み替えたキーボードなど）。
// 同時押し（Ctrl+C など）は、指を「L5+L2」のように組み合わせて登録する（仕様書 ⑤ keys.finger）。
// 練習の記録があるキーボードは、過去の記録の指の分析を変えないため、割り当てを変えられない（写して新しく作る）。
const FINGERS = ["L1", "L2", "L3", "L4", "L5", "R1", "R2", "R3", "R4", "R5"];
const FINGER_NAMES: Record<string, string> = { "1": "親指", "2": "人差し指", "3": "中指", "4": "薬指", "5": "小指" };
const oneFinger = (f: string) => {
  const m = /^([LR])([1-5])$/.exec(f);
  return m ? `${m[1] === "L" ? "左" : "右"}${FINGER_NAMES[m[2]]}` : f;
};
const fingerText = (f: string) => `${f}（${f.split("+").map(oneFinger).join(" ＋ ")}）`;
// 初めの割り当て（copyFrom が空のとき）。値は "template:..."、写すときはキーボードの id
const TEMPLATE_NAMES: Record<string, string> = {
  capture: "キーを押して登録する（おすすめ）",
  "template:keyball44": "Keyball44 の標準の割り当てを使う",
  "template:jis": "JIS 配列の標準の割り当てを使う",
  "template:us": "US 配列の標準の割り当てを使う",
  "template:empty": "キーを 1 つずつ手で追加する",
};
// 画面での表記（keys の内部の名前を、打つ文字に直して見せる）
const SHOWN: Record<string, string> = { KC_SCLN: ";", KC_SLSH: "/", Space: "スペース" };

export function KeyboardSettings({ onBack }: { onBack: () => void }) {
  const [data, setData] = useState<Settings | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [newName, setNewName] = useState("");
  const [copyFrom, setCopyFrom] = useState<string>("capture");
  const [layout, setLayout] = useState<Layout>("free");
  const [open, setOpen] = useState<number | null>(null);
  // 「キーを押して登録」をしているキーボード（追加した直後は自動でそのキーボードの登録に入る）
  const [capturing, setCapturing] = useState<number | null>(null);
  // 練習に使うキーボード（トップの「使うキーボード」と同じもの）
  const [using, setUsing] = useState<number | null>(keyboardChoice.get());

  const reload = () =>
    api
      .keyboardSettings()
      .then((d) => {
        setData(d);
        // 使うキーボードが決まっていない・削除された・別の人のものなら、一覧の最初のキーボードを使う
        const cur = keyboardChoice.get();
        if (!d.keyboards.some((k) => k.id === cur)) {
          const first = d.keyboards[0]?.id ?? null;
          keyboardChoice.set(first);
          setUsing(first);
        }
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

  return (
    <div className="card">
      <button className="secondary" onClick={onBack}>
        <Icon name="back" />
        レベル選択に戻る
      </button>
      <h2 className="section-title">
        <Icon name="keyboard" />
        キーボードの設定
      </h2>
      <p className="muted">
        お使いのキーボードごとに、各キーをどの指で押すか（L1〜L5 は左手、R1〜R5 は右手。1 が親指、5
        が小指）を登録します。登録した内容は、指ごとのミス率の集計と苦手克服トレーニングの分析に使います。
        練習の記録があるキーボードは、過去の分析結果が変わらないように、割り当てを変更できません。変更したい場合は、そのキーボードの割り当てを写して新しいキーボードを追加してください。
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
      {!data && !error && <p className="muted">読み込んでいます…</p>}

      {data &&
        (() => {
          // 選んだ写し元のキーボードが削除された・別のユーザーに切り替わったときは、既定（キーを押して登録）に戻す
          const choice = copyFrom in TEMPLATE_NAMES || data.keyboards.some((k) => String(k.id) === copyFrom) ? copyFrom : "capture";
          return (
            <>
              <ul className="kb-list">
                {data.keyboards.map((k) => (
                  <li key={`${k.id}:${k.name}:${k.keys.length}`} className="manage-box" aria-label={`キーボード ${k.name}`}>
                    <KeyboardRow
                      kb={k}
                      open={open === k.id}
                      onToggle={() => setOpen(open === k.id ? null : k.id)}
                      onRename={(name) => run(() => api.updateKeyboard(k.id, { name }), `名前を「${name}」に変更しました。`)}
                      onLayout={(l) =>
                        run(() => api.updateKeyboard(k.id, { layout: l }), `「${k.name}」のキーの並びを「${LAYOUT_NAMES[l]}」に変更しました。`)
                      }
                      onSaveKeys={(keys) => run(() => api.updateKeyboard(k.id, { keys }), `「${k.name}」の割り当てを保存しました。`)}
                      using={using === k.id}
                      onUse={() => {
                        keyboardChoice.set(k.id);
                        setUsing(k.id);
                        setError("");
                        setMessage(`練習に使うキーボードを「${k.name}」にしました。`);
                      }}
                      capturing={capturing === k.id}
                      onCapture={(on) => {
                        setCapturing(on ? k.id : null);
                        if (on) setOpen(null);
                      }}
                      onCaptured={(keys) => {
                        setCapturing(null);
                        if (keys.length === 0) {
                          setError("キーが 1 つも登録されていないため、保存しませんでした。もう一度「キーを押して登録」からやり直してください。");
                          return;
                        }
                        run(() => api.updateKeyboard(k.id, { keys }), `「${k.name}」に ${keys.length} 個のキーを登録し、保存しました。`);
                      }}
                      onDelete={() =>
                        confirm(`キーボード「${k.name}」を削除しますか？\n（これまでの練習の記録と分析結果は残ります）`) &&
                        run(async () => {
                          await api.deleteKeyboard(k.id);
                          if (keyboardChoice.get() === k.id) keyboardChoice.set(null); // 一覧を読み直すときに、残っている最初のキーボードにする
                        }, `キーボード「${k.name}」を削除しました。`)
                      }
                    />
                  </li>
                ))}
              </ul>
              {data.keyboards.length === 0 && (
                <p className="muted">登録されているキーボードはありません。下の「キーボードを追加」から追加してください。</p>
              )}

              <form
                className="manage-box kb-add"
                onSubmit={(e) => {
                  e.preventDefault();
                  const name = newName.trim();
                  if (!name) return;
                  const capture = choice === "capture";
                  run(
                    async () => {
                      // キーを押して登録するときは空で作り、そのまま登録の画面に入る
                      const template = capture ? "empty" : choice.startsWith("template:") ? choice.slice("template:".length) : undefined;
                      const { id } = await api.addKeyboard(name, template ? null : Number(choice), layout, template);
                      setNewName("");
                      if (capture) setCapturing(id);
                    },
                    capture
                      ? `キーボード「${name}」を追加しました。続けて、下の枠に表示される文字のキーを順に押してください。`
                      : `キーボード「${name}」を追加しました。`,
                  );
                }}
              >
                <div className="box-heading">キーボードを追加</div>
                <div className="kb-add-row">
                  <label>
                    名前
                    <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="例: 学校の JIS キーボード" maxLength={50} />
                  </label>
                  <label>
                    キーの登録のしかた
                    <select value={choice} onChange={(e) => setCopyFrom(e.target.value)}>
                      {Object.entries(TEMPLATE_NAMES).map(([v, label]) => (
                        <option key={v} value={v}>
                          {label}
                        </option>
                      ))}
                      {data.keyboards.map((k) => (
                        <option key={k.id} value={k.id}>
                          「{k.name}」の割り当てを写す
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    キーの並び
                    <select value={layout} aria-label="追加するキーボードのキーの並び" onChange={(e) => setLayout(e.target.value as Layout)}>
                      {(Object.keys(LAYOUT_NAMES) as Layout[]).map((l) => (
                        <option key={l} value={l}>
                          {LAYOUT_NAMES[l]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button type="submit" disabled={newName.trim() === ""}>
                    追加
                  </button>
                </div>
                <p className="muted">
                  「キーを押して登録する」を選ぶと、追加の直後に文字が 1
                  つずつ表示されます。表示された文字のキーを押し、そのキーを押す指を選んでください。お使いのキーボードにないキーは飛ばせます。
                  「キーの並び」は、練習中の画面に表示するキーボードの形です。JIS・US・Keyball44
                  以外のキーボード（キー配置を変えたもの、キーの少ないもの、格子状のものなど）では「自由な配列」を選ぶと、登録したキーを指ごとに並べて表示します。
                  登録した内容は、あとから「キーを押して登録」や「割り当てを編集」でやり直したり、変更したりできます。Fn キーや同時押しのキー（例:
                  Ctrl+C）は、「割り当てを編集」から手で追加してください。
                </p>
              </form>
            </>
          );
        })()}
    </div>
  );
}

function KeyboardRow({
  kb,
  open,
  onToggle,
  onRename,
  onLayout,
  onSaveKeys,
  onDelete,
  using,
  onUse,
  capturing,
  onCapture,
  onCaptured,
}: {
  kb: Settings["keyboards"][number];
  open: boolean;
  onToggle: () => void;
  onRename: (name: string) => void;
  onLayout: (layout: Layout) => void;
  onSaveKeys: (keys: KeyAssign[]) => void;
  onDelete: () => void;
  using: boolean;
  onUse: () => void;
  capturing: boolean;
  onCapture: (on: boolean) => void;
  onCaptured: (keys: KeyAssign[]) => void;
}) {
  const [name, setName] = useState(kb.name);
  const [keys, setKeys] = useState<KeyAssign[]>(kb.keys);
  const [editing, setEditing] = useState<string | null>(null); // 指を変えているキー
  const [newChar, setNewChar] = useState("");
  const changed = JSON.stringify(keys) !== JSON.stringify(kb.keys);
  return (
    <>
      <div className={`manage-row kb-row${using ? " kb-using" : ""}`}>
        {/* 左端: 練習に使うキーボードは「使用中」、ほかは「選択」ボタン */}
        <div className="kb-use">
          {using ? (
            <span className="badge kb-using-badge" aria-label={`「${kb.name}」を練習に使用中`}>
              <Icon name="check" />
              使用中
            </span>
          ) : (
            <button className="secondary kb-select" onClick={onUse} aria-label={`「${kb.name}」を練習に使うキーボードとして選択`}>
              選択
            </button>
          )}
        </div>
        <input value={name} aria-label="キーボードの名前" onChange={(e) => setName(e.target.value)} maxLength={50} />
        <select value={kb.layout} aria-label={`${kb.name} のキーの並び`} onChange={(e) => onLayout(e.target.value as Layout)}>
          {(Object.keys(LAYOUT_NAMES) as Layout[]).map((l) => (
            <option key={l} value={l}>
              {LAYOUT_NAMES[l]}
            </option>
          ))}
        </select>
        <span className="muted">
          {kb.keys.length} 個のキー{kb.used ? "・練習の記録あり" : ""}
        </span>
        <div className="row-actions">
          <button onClick={() => onRename(name.trim())} disabled={name.trim() === "" || name.trim() === kb.name}>
            名前を保存
          </button>
          {!kb.used && (
            <button onClick={() => onCapture(!capturing)} aria-pressed={capturing}>
              <Icon name="keyboard" />
              キーを押して登録
            </button>
          )}
          <button className="secondary" onClick={onToggle} aria-expanded={open}>
            {kb.used ? "割り当てを見る" : "割り当てを編集"}
          </button>
          <button className="danger" onClick={onDelete}>
            削除
          </button>
        </div>
      </div>
      {capturing && !kb.used && <KeyCapture keys={kb.keys} onDone={onCaptured} onCancel={() => onCapture(false)} />}
      {open && (
        <div className="kb-keys">
          {/* キーごとのカード（大きなキーの文字と、担当の指）。並びは英字・数字・記号・そのほかの順 */}
          {keys.length === 0 && <p className="muted">まだキーが登録されていません。「キーを押して登録」か、下の欄から追加してください。</p>}
          <ul className="kb-key-grid">
            {sortKeys(keys).map((k) => {
              const label = SHOWN[k.char] ?? k.char;
              const selected = editing === k.char;
              return (
                <li key={k.char}>
                  <button
                    className={`kb-key-card${selected ? " selected" : ""}`}
                    onClick={() => setEditing(selected ? null : k.char)}
                    disabled={kb.used}
                    aria-pressed={selected}
                    aria-label={`${label}：${fingerText(k.finger)}${kb.used ? "" : "（押すと指を変えられます）"}`}
                  >
                    <span className={`kb-keycap${Array.from(label).length > 2 ? " long" : ""}`}>{label}</span>
                    <span className="kb-key-finger">{k.finger.split("+").map(oneFinger).join(" ＋ ")}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {/* 選んだキーの指を変える: 10 本の指のボタン（2 本以上選ぶと同時押し） */}
          {!kb.used && editing && keys.some((k) => k.char === editing) && (
            <FingerPanel
              label={SHOWN[editing] ?? editing}
              value={keys.find((k) => k.char === editing)!.finger}
              onChange={(finger) => setKeys(keys.map((x) => (x.char === editing ? { ...x, finger } : x)))}
              onRemove={() => {
                setKeys(keys.filter((x) => x.char !== editing));
                setEditing(null);
              }}
              onClose={() => setEditing(null)}
            />
          )}
          {!kb.used && (
            <div className="row-actions kb-key-actions">
              <input
                value={newChar}
                onChange={(e) => setNewChar(e.target.value)}
                aria-label="追加するキー"
                placeholder="追加するキー（例: Q、Enter、Ctrl+C、Fn）"
                maxLength={20}
              />
              <button
                className="secondary"
                disabled={newChar.trim() === "" || keys.some((k) => k.char === toKeyName(newChar.trim()))}
                onClick={() => {
                  setKeys([...keys, { char: toKeyName(newChar.trim()), finger: "L2" }]);
                  setNewChar("");
                }}
              >
                キーを追加
              </button>
              <button
                onClick={() => {
                  // 同じ指を 2 回選んだ同時押し（L2+L2）は 1 本にまとめる
                  onSaveKeys(keys.map((k) => ({ ...k, finger: [...new Set(k.finger.split("+"))].join("+") })));
                }}
                disabled={!changed || keys.length === 0}
              >
                割り当てを保存
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}

// カードの並び: 英字（A〜Z）→ 数字 → 記号 → そのほか（Space・Enter・Ctrl+C など）。同じ種類の中は文字の順
function sortKeys(keys: KeyAssign[]): KeyAssign[] {
  const rank = (c: string) => (/^[A-Z]$/.test(c) ? 0 : /^\d$/.test(c) ? 1 : Array.from(SHOWN[c] ?? c).length === 1 ? 2 : 3);
  return [...keys].sort((a, b) => rank(a.char) - rank(b.char) || a.char.localeCompare(b.char));
}

// 入力したキーを keys.char の表記にそろえる（分析と同じ規則: 英字 1 文字は大文字、; / 空白は内部の名前）
function toKeyName(s: string): string {
  if (s === ";") return "KC_SCLN";
  if (s === "/") return "KC_SLSH";
  if (s === " " || s === "スペース") return "Space";
  return /^[a-z]$/.test(s) ? s.toUpperCase() : s;
}

// 選んだキーの担当の指を、10 本の指のボタンで選ぶ。押すたびに選ぶ・外すが切り替わり、2 本以上選ぶと同時押し（例: L5+L2）
const PANEL_HANDS: { hand: string; fingers: string[] }[] = [
  { hand: "左手", fingers: ["L5", "L4", "L3", "L2", "L1"] },
  { hand: "右手", fingers: ["R1", "R2", "R3", "R4", "R5"] },
];
function FingerPanel({
  label,
  value,
  onChange,
  onRemove,
  onClose,
}: {
  label: string;
  value: string;
  onChange: (finger: string) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const chosen = value.split("+").filter((f) => FINGERS.includes(f));
  const toggle = (f: string) => {
    const next = chosen.includes(f) ? chosen.filter((x) => x !== f) : [...chosen, f];
    if (next.length > 0) onChange(next.join("+")); // 指が 0 本にはしない
  };
  return (
    <div className="kb-finger-panel" role="group" aria-label={`${label} の指`}>
      <div className="kb-finger-panel-head">
        <span className="kb-keycap">{label}</span>
        <span>
          を押す指：<strong>{chosen.map(oneFinger).join(" ＋ ")}</strong>
          <span className="muted">（押して選びます。2 本以上選ぶと同時押しになります）</span>
        </span>
      </div>
      <div className="key-capture-hands">
        {PANEL_HANDS.map((h) => (
          <div key={h.hand} className="key-capture-hand" aria-label={h.hand}>
            {h.fingers.map((f) => (
              <button
                key={f}
                className={`${chosen.includes(f) ? "" : "secondary "}finger-btn`}
                aria-pressed={chosen.includes(f)}
                onClick={() => toggle(f)}
              >
                {oneFinger(f)}
              </button>
            ))}
          </div>
        ))}
      </div>
      <div className="row-actions">
        <button className="secondary" onClick={onClose}>
          閉じる
        </button>
        <button className="danger" onClick={onRemove}>
          「{label}」を外す
        </button>
      </div>
    </div>
  );
}
