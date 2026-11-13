import { useEffect, useState } from "react";
import { api, type AdminLevel, type AdminStage } from "./api";
import { Icon } from "./Icon";

// 教員: ステージ・レベルの管理（表示順・タイトル・説明・AI への指示文）
// 保存・削除の結果は、操作した行のすぐ横に出す（画面の上だけに出すと、下の行では見えないため）。
export function ManageLevels() {
  const [stages, setStages] = useState<AdminStage[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  // 直前に保存した行（一覧を読み直すと行は作り直されるので、「保存しました」は親が覚えておく）
  const [savedRow, setSavedRow] = useState("");

  const reload = () =>
    api
      .adminStages()
      .then(setStages)
      .catch((e) => setError(e.message));
  useEffect(() => {
    reload();
  }, []);

  // 削除・追加のように行そのものが消えたり増えたりする操作は、画面の上に結果を出す
  async function run(action: () => Promise<unknown>, done: string) {
    setError("");
    setMessage("");
    setSavedRow("");
    try {
      await action();
      setMessage(done);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="card">
      <h2 className="section-title">
        <Icon name="layers" />
        ステージ・レベルの管理
      </h2>
      <p className="muted">
        表示順は小さい数字ほど上に出ます。削除したステージ・レベルは、この画面と学生の画面から消えます。練習の記録があるものは、記録を守るため、記録だけはデータベースに残ります（学習分析にも残ります）。
      </p>
      <details className="muted prompt-help">
        <summary>AI への指示文の書き方</summary>
        <p>
          指示文には、問題の種類（例: 人差し指、上の段、英単語、英文、ローマ字、ひらがな、カタカナ、漢字、日本語の文、数字、記号、プログラム）、
          長さ（短い・長い・初心者・上級・「5文字」・「3〜5語」）、個数（「10個」）を書きます。使うキーを指定するときは「（s と
          l）」のように書きます。 問題は 1 問 40 文字までで、半角の英数字・記号、またはひらがな・カタカナ・漢字・日本語の句読点を使えます。
        </p>
        <p>
          AI モックにつないでいるときは、上に書いた言葉だけを読み取ります。研究室の
          LLM（Qwen）につないでいるときは、自由な文の指示でも問題を作れます。
        </p>
      </details>
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
      {stages.map((s) => (
        <section key={s.id} className="manage-stage">
          {/* key に内容を含め、一覧を読み直したら入力欄も新しい値で作り直す */}
          <StageForm
            key={`${s.id}:${s.sort_order}:${s.title}:${s.description}:${s.is_active}:${s.levels.length}`}
            stage={s}
            justSaved={savedRow === `stage:${s.id}`}
            onSave={async (v) => {
              await api.updateStage(s.id, v);
              setMessage("");
              setSavedRow(`stage:${s.id}`);
              await reload();
            }}
            onDelete={() => run(() => api.deleteStage(s.id), `ステージ「${s.title}」を削除しました`)}
          />
          {s.levels.map((l) => (
            <LevelForm
              key={`${l.id}:${l.sort_order}:${l.title}:${l.description}:${l.prompt}:${l.is_active}:${l.logCount}`}
              level={l}
              justSaved={savedRow === `level:${l.id}`}
              onSave={async (v) => {
                const { pass, ...rest } = v;
                await api.updateLevel(l.id, { ...rest, pass_accuracy: passToApi(pass) });
                setMessage("");
                setSavedRow(`level:${l.id}`);
                await reload();
              }}
              onDelete={() => run(() => api.deleteLevel(l.id), `レベル「${l.title}」を削除しました`)}
            />
          ))}
          <NewLevel
            onAdd={(v) =>
              run(
                () => api.createLevel({ title: v.title, prompt: v.prompt, description: v.description, sort_order: v.sort_order, stage_id: s.id }),
                `レベル「${v.title}」を追加しました`,
              )
            }
          />
        </section>
      ))}
      <NewStage onAdd={(v) => run(() => api.createStage(v), `ステージ「${v.title}」を追加しました`)} />
    </div>
  );
}

type StageValues = { title: string; description: string; sort_order: number };
// pass: 合格の目安の正確率（%）。空なら目安なし（自由に練習するレベル）
type LevelValues = StageValues & { prompt: string; pass: string };
// 画面の % の文字を、API の 0〜1 の値にする（空は null）
export const passToApi = (pass: string): number | null => (pass.trim() === "" ? null : Number(pass) / 100);

// 行ごとの保存の状態（結果は行の横に出す）
type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "saved" } | { kind: "error"; message: string };

function useRowSave<T>(initial: T, onSave: (v: T) => Promise<void>, justSaved: boolean) {
  const [v, setV] = useState<T>(initial);
  const [state, setState] = useState<SaveState>(justSaved ? { kind: "saved" } : { kind: "idle" });
  const changed = JSON.stringify(v) !== JSON.stringify(initial);
  const update = (next: T) => {
    setV(next);
    setState({ kind: "idle" });
  };
  async function save() {
    setState({ kind: "saving" });
    try {
      // 成功すると一覧を読み直し、この行は新しい値で作り直される（「保存しました」は親の justSaved で出す）
      await onSave(v);
      setState({ kind: "saved" });
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }
  return { v, update, state, changed, save };
}

function SaveStatus({ state, changed }: { state: SaveState; changed: boolean }) {
  if (state.kind === "saving") return <span className="muted">保存しています…</span>;
  if (state.kind === "error") return <span className="error">保存できませんでした: {state.message}</span>;
  if (state.kind === "saved") return <span className="ok-message">保存しました</span>;
  if (changed) return <span className="muted">変更があります。「保存」を押してください</span>;
  return null;
}

// 削除のボタン。どれに対するボタンか分かるよう、文字に「ステージ」「レベル」を入れる。
// 記録のあるものは、確認の文で「記録は残る」ことを伝える
function DeleteButton({
  kind,
  label,
  hasRecords,
  onDelete,
}: {
  kind: "ステージ" | "レベル";
  label: string;
  hasRecords: boolean;
  onDelete: () => void;
}) {
  const note = hasRecords ? "この画面と学生の画面から消えます。練習の記録は残ります。" : "元に戻せません。";
  return (
    <button className="danger" onClick={() => confirm(`${label}を削除しますか？（${note}）`) && onDelete()}>
      {kind}を削除
    </button>
  );
}

function StageForm({
  stage,
  justSaved,
  onSave,
  onDelete,
}: {
  stage: AdminStage;
  justSaved: boolean;
  onSave: (v: StageValues) => Promise<void>;
  onDelete: () => void;
}) {
  const row = useRowSave<StageValues>({ title: stage.title, description: stage.description ?? "", sort_order: stage.sort_order }, onSave, justSaved);
  const { v, update } = row;
  return (
    <div className="manage-box stage-box" aria-label={`ステージ ${stage.title}`}>
      <div className="box-heading">ステージ</div>
      <div className="manage-row stage-row">
        <input
          className="order"
          type="number"
          value={v.sort_order}
          aria-label="表示順"
          onChange={(e) => update({ ...v, sort_order: Number(e.target.value) })}
        />
        <input value={v.title} aria-label="ステージ名" onChange={(e) => update({ ...v, title: e.target.value })} />
        <input value={v.description} aria-label="ステージの説明" placeholder="説明" onChange={(e) => update({ ...v, description: e.target.value })} />
        <div className="row-actions">
          <button onClick={row.save} disabled={!row.changed || row.state.kind === "saving"}>
            保存
          </button>
          <DeleteButton
            kind="ステージ"
            label={`ステージ「${stage.title}」${stage.levels.length > 0 ? `（中のレベル ${stage.levels.length} 個も削除）` : ""}`}
            hasRecords={stage.levels.some((l) => l.logCount > 0)}
            onDelete={onDelete}
          />
          <SaveStatus state={row.state} changed={row.changed} />
        </div>
      </div>
    </div>
  );
}

function LevelForm({
  level,
  justSaved,
  onSave,
  onDelete,
}: {
  level: AdminLevel;
  justSaved: boolean;
  onSave: (v: LevelValues) => Promise<void>;
  onDelete: () => void;
}) {
  const row = useRowSave<LevelValues>(
    {
      title: level.title,
      description: level.description ?? "",
      sort_order: level.sort_order,
      prompt: level.prompt,
      pass: level.pass_accuracy === null ? "" : String(Math.round(level.pass_accuracy * 1000) / 10),
    },
    onSave,
    justSaved,
  );
  const { v, update } = row;
  return (
    <div className="manage-box level-box" aria-label={`レベル ${level.title}`}>
      <div className="box-heading">レベル</div>
      <div className="manage-row">
        <input
          className="order"
          type="number"
          value={v.sort_order}
          aria-label="表示順"
          onChange={(e) => update({ ...v, sort_order: Number(e.target.value) })}
        />
        <input value={v.title} aria-label="レベル名" onChange={(e) => update({ ...v, title: e.target.value })} />
        <input value={v.description} aria-label="レベルの説明" placeholder="説明" onChange={(e) => update({ ...v, description: e.target.value })} />
        <textarea value={v.prompt} aria-label="AI への指示文" onChange={(e) => update({ ...v, prompt: e.target.value })} />
        <label className="pass-field">
          合格の目安（正確率）
          <span>
            <input
              type="number"
              min={1}
              max={100}
              step={1}
              value={v.pass}
              aria-label="合格の目安（正確率 %）"
              placeholder="なし"
              onChange={(e) => update({ ...v, pass: e.target.value })}
            />
            % 以上（空欄なら目安なし・自由に練習）
          </span>
        </label>
        <div className="row-actions">
          <button onClick={row.save} disabled={!row.changed || row.state.kind === "saving"}>
            保存
          </button>
          <DeleteButton kind="レベル" label={`レベル「${level.title}」`} hasRecords={level.logCount > 0} onDelete={onDelete} />
          <SaveStatus state={row.state} changed={row.changed} />
        </div>
      </div>
    </div>
  );
}

function NewStage({ onAdd }: { onAdd: (v: StageValues) => void }) {
  const [title, setTitle] = useState("");
  return (
    <div className="manage-box new-box new-stage-box">
      <div className="box-heading">ステージを追加</div>
      <div className="manage-row">
        <input value={title} aria-label="新しいステージ名" placeholder="新しいステージ名" onChange={(e) => setTitle(e.target.value)} />
        <button
          className="secondary"
          disabled={title.trim() === ""}
          onClick={() => {
            onAdd({ title, description: "", sort_order: 0 });
            setTitle("");
          }}
        >
          ステージを追加
        </button>
      </div>
    </div>
  );
}

function NewLevel({ onAdd }: { onAdd: (v: LevelValues) => void }) {
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  return (
    <div className="manage-box level-box new-box">
      <div className="box-heading">レベルを追加</div>
      <div className="manage-row">
        <input value={title} aria-label="新しいレベル名" placeholder="新しいレベル名" onChange={(e) => setTitle(e.target.value)} />
        <textarea
          value={prompt}
          aria-label="新しいレベルの AI への指示文"
          placeholder="AI への指示文（必須）"
          onChange={(e) => setPrompt(e.target.value)}
        />
        <button
          className="secondary"
          disabled={title.trim() === "" || prompt.trim() === ""}
          onClick={() => {
            onAdd({ title, prompt, description: "", sort_order: 0, pass: "" });
            setTitle("");
            setPrompt("");
          }}
        >
          レベルを追加
        </button>
      </div>
    </div>
  );
}
