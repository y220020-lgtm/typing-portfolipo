// 日時の表示。記録（logs）は UTC で保存し、画面では常に日本時間で表示する（見る端末の設定に左右されないように）。
// タイムゾーン表記のない日時（タイピング.db のデモデータ）は UTC として扱う（shared/score.ts と同じ）。
const toDate = (iso: string) => new Date(/(Z|[+-]\d{2}:?\d{2})$/.test(iso) ? iso : `${iso}Z`);

const parts = (iso: string) => {
  const p = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(toDate(iso));
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return { y: get("year"), m: get("month"), d: get("day"), h: get("hour"), min: get("minute") };
};

// 例: 10/16 13:57
export function shortDateJst(iso: string): string {
  const p = parts(iso);
  return `${p.m}/${p.d} ${p.h}:${p.min}`;
}

// 例: 2026/10/16 13:57
export function dateTimeJst(iso: string): string {
  const p = parts(iso);
  return `${p.y}/${p.m}/${p.d} ${p.h}:${p.min}`;
}

// 締め切りの日（日本時間の YYYY-MM-DD）を、その日の 23:59:59.999（日本時間）の UTC の ISO8601 にする
export function endOfDayJstIso(date: string): string {
  return new Date(Date.parse(`${date}T23:59:59.999+09:00`)).toISOString();
}
// 上の逆: ISO8601 から日本時間の YYYY-MM-DD
export function dateInputJst(iso: string): string {
  const p = parts(iso);
  return `${p.y}-${p.m.padStart(2, "0")}-${p.d.padStart(2, "0")}`;
}
