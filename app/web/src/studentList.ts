// 教員の学生一覧の並べ替え・検索と、学生の追加の入力の読み取り（画面とテストで共通）
import type { StudentRow } from "./api";

export type SortKey = "id" | "name" | "sessions" | "questions" | "wpm" | "cpm" | "accuracy" | "lastPlayed";
export type Sort = { key: SortKey; dir: "asc" | "desc" };

// 成績の値（練習していない学生は null）
function valueOf(s: StudentRow, key: SortKey): string | number | null {
  switch (key) {
    case "id":
      return s.id;
    case "name":
      return s.name;
    case "sessions":
      return s.sessions;
    case "questions":
      return s.questions;
    case "wpm":
      return s.questions > 0 ? s.total.wpm : null;
    case "cpm":
      return s.questions > 0 ? s.total.cpm : null;
    case "accuracy":
      return s.questions > 0 ? s.total.accuracy : null;
    case "lastPlayed":
      return s.lastPlayed;
  }
}

// 並べ替え。値のない学生（練習していない）は、どちらの向きでもいつも最後。同じ値なら学籍番号順
export function sortStudents(rows: StudentRow[], sort: Sort): StudentRow[] {
  const sign = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = valueOf(a, sort.key);
    const vb = valueOf(b, sort.key);
    if (va === null && vb !== null) return 1;
    if (vb === null && va !== null) return -1;
    let c = 0;
    if (va !== null && vb !== null) c = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb), "ja");
    return c !== 0 ? c * sign : a.id.localeCompare(b.id);
  });
}

// 同じ列を押すと向きを変える。別の列は、文字の列は昇順、数の列は降順（成績の高い順）から
export function nextSort(cur: Sort, key: SortKey): Sort {
  if (cur.key === key) return { key, dir: cur.dir === "asc" ? "desc" : "asc" };
  return { key, dir: key === "id" || key === "name" ? "asc" : "desc" };
}

// 学籍番号か名前に、入れた文字が含まれる学生（大文字・小文字は区別しない）
export function filterStudents(rows: StudentRow[], query: string): StudentRow[] {
  const q = query.trim().toLowerCase();
  if (q === "") return rows;
  return rows.filter((s) => s.id.toLowerCase().includes(q) || s.name.toLowerCase().includes(q));
}

// 追加の入力: 1 行に「学籍番号,名前」。区切りはカンマ・タブ・空白（表計算ソフトからのコピー用）。空の行は無視
// 名前に空白を含めてよいよう、最初の区切りだけで分ける
export function parseStudentLines(text: string): { users: { id: string; name: string }[]; errors: string[] } {
  const users: { id: string; name: string }[] = [];
  const errors: string[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    const t = line.trim();
    if (t === "") return;
    const m = /^([^,\t\s]+)\s*[,\t\s、，]\s*(.+)$/.exec(t);
    if (!m) errors.push(`${i + 1} 行目: 「学籍番号,名前」の形にしてください（${t}）`);
    else users.push({ id: m[1], name: m[2].trim() });
  });
  return { users, errors };
}
