// ライト / ダークのテーマ。選んだテーマは端末に保存し、再読み込み後も使う。
// 選んでいないときは、端末（OS）の設定に合わせる（CSS の prefers-color-scheme）。
export type Theme = "light" | "dark";
const KEY = "typing-theme";

export function savedTheme(): Theme | null {
  try {
    const t = localStorage.getItem(KEY);
    return t === "light" || t === "dark" ? t : null;
  } catch {
    return null;
  }
}

// 今の見た目のテーマ（保存がなければ端末の設定）
export function currentTheme(): Theme {
  return savedTheme() ?? (window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light");
}

export function applyTheme(t: Theme | null): void {
  if (t) document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}

export function setTheme(t: Theme): void {
  try {
    localStorage.setItem(KEY, t);
  } catch {
    // 保存できない（プライベートモードなど）ときも、この画面では切り替える
  }
  applyTheme(t);
}
