import { useState, type FormEvent } from "react";
import { api, tokenStore, type User } from "./api";
import { Icon } from "./Icon";

// 学生も教員も同じ欄に ID を入れる（教員かどうかはサーバーが ID で決める）
export function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const [id, setId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await api.login(id);
      tokenStore.set(res.token);
      onLogin(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <form className="card login-card" onSubmit={submit}>
        <div className="login-hero">
          <div className="brand-mark">
            <Icon name="keyboard" />
          </div>
          <h2>ログイン</h2>
          <p className="muted">学籍番号を入力して、タイピング練習を始めましょう。</p>
        </div>
        <label>
          学籍番号（教員は教員 ID）
          <input value={id} onChange={(e) => setId(e.target.value)} autoFocus placeholder="例: y220020" autoComplete="username" />
        </label>
        <button type="submit" disabled={busy || id.trim() === ""}>
          はじめる
        </button>
        {error && (
          <p className="error" role="alert">
            <Icon name="alert" />
            {error}
          </p>
        )}
      </form>
    </div>
  );
}
