import { useState } from "react";
import { currentTheme, setTheme, type Theme } from "./theme";

// テーマの切り替え（ヘッダーの右上）。押すとライトとダークが入れ替わる
export function ThemeToggle() {
  const [theme, setState] = useState<Theme>(currentTheme());
  const next: Theme = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={() => {
        setTheme(next);
        setState(next);
      }}
      aria-label={next === "dark" ? "ダークモードにする" : "ライトモードにする"}
      title={next === "dark" ? "ダークモードにする" : "ライトモードにする"}
    >
      <span aria-hidden="true">{theme === "dark" ? "☾" : "☀"}</span>
      <span className="theme-label">{theme === "dark" ? "ダーク" : "ライト"}</span>
    </button>
  );
}
