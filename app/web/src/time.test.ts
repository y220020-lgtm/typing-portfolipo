import { describe, expect, it } from "vitest";
import { dateInputJst, dateTimeJst, endOfDayJstIso, shortDateJst } from "./time";

describe("日時の表示（常に日本時間）", () => {
  it("UTC を日本時間（+9 時間）で表示する", () => {
    expect(shortDateJst("2026-10-16T04:57:00.000Z")).toBe("10/16 13:57");
    expect(dateTimeJst("2026-10-16T04:59:17.123Z")).toBe("2026/10/16 13:59");
  });
  it("日付の変わり目: UTC 15:00 は日本時間の翌日 0:00", () => {
    expect(shortDateJst("2026-10-16T15:00:00.000Z")).toBe("10/17 00:00");
    expect(dateTimeJst("2026-12-31T15:30:00.000Z")).toBe("2027/1/1 00:30");
  });
  it("タイムゾーン表記のない日時（デモデータ）は UTC として扱う", () => {
    expect(shortDateJst("2026-06-01T10:00:00")).toBe("6/1 19:00");
  });
});

describe("締め切りの日", () => {
  it("日本時間の日付を、その日の終わり（日本時間）の UTC にし、元に戻せる", () => {
    expect(endOfDayJstIso("2026-10-31")).toBe("2026-10-31T14:59:59.999Z");
    expect(dateInputJst("2026-10-31T14:59:59.999Z")).toBe("2026-10-31");
  });
});
