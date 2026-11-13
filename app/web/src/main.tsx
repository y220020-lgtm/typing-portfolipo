import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./style.css";
import { applyTheme, savedTheme } from "./theme";

// 最初の表示の前に、保存したテーマを当てる（一瞬だけ違う色が出ないように）
applyTheme(savedTheme());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
