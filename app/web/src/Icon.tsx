// 画面で使うアイコン（線で描く同じ形式にそろえる。外部のライブラリは使わない）
const PATHS = {
  keyboard: "M3 7h18v10H3z M7 11h.01 M11 11h.01 M15 11h.01 M7 14h10",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4 21a8 8 0 0 1 16 0",
  logout: "M15 4h4v16h-4 M10 16l4-4-4-4 M14 12H4",
  chart: "M4 20V10 M10 20V4 M16 20v-7 M22 20H2",
  play: "M8 5l11 7-11 7z",
  target: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 7v5l3 2",
  check: "M5 12l5 5L20 7",
  alert: "M12 9v4 M12 17h.01 M10.3 3.9 2.6 17a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
  users: "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M2 21a7 7 0 0 1 14 0 M17 3.5a4 4 0 0 1 0 7.5 M22 21a7 7 0 0 0-4-6.3",
  layers: "M12 3 2 8l10 5 10-5z M2 16l10 5 10-5 M2 12l10 5 10-5",
  download: "M12 4v12 M7 11l5 5 5-5 M4 20h16",
  plus: "M12 5v14 M5 12h14",
  back: "M15 18l-6-6 6-6",
  lock: "M6 11h12v10H6z M8 11V7a4 4 0 0 1 8 0v4",
  trend: "M3 17l6-6 4 4 8-8 M15 7h6v6",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, label }: { name: IconName; label?: string }) {
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
