import { describe, expect, it } from "vitest";
import { keyFor } from "./OnScreenKeyboard";

describe("画面のキーボード: 次に打つ文字から光らせるキー", () => {
  it("英小文字・空白はそのキー、英大文字は Shift と小文字のキー", () => {
    expect(keyFor("a")).toEqual({ key: "a", shift: false });
    expect(keyFor(" ")).toEqual({ key: " ", shift: false });
    expect(keyFor("Q", "keyball44")).toEqual({ key: "q", shift: true });
  });
  it("記号は並びごとに違う: @ は JIS ではそのキー、US では Shift+2。: は JIS ではそのキー、US では Shift+;", () => {
    expect(keyFor("@", "jis")).toEqual({ key: "@", shift: false });
    expect(keyFor("@", "us")).toEqual({ key: "2", shift: true });
    expect(keyFor(":", "jis")).toEqual({ key: ":", shift: false });
    expect(keyFor(":", "us")).toEqual({ key: ";", shift: true });
  });
  it("Keyball44 には数字の段がないので、数字は「画面にないキー」", () => {
    expect(keyFor("1", "keyball44")).toEqual({ key: null, shift: false });
    expect(keyFor("1", "jis")).toEqual({ key: "1", shift: false });
  });
});

describe("画面のキーボード: 自由な配列（登録したキーを指ごとに表示）", () => {
  it("登録したキーだけを指の列に並べ、次に打つキーと指を光らせる。同時押しのキーには + を付ける", async () => {
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { OnScreenKeyboard } = await import("./OnScreenKeyboard");
    const keys = [
      { char: "A", finger: "L5" },
      { char: "S", finger: "L4" },
      { char: "Ctrl+C", finger: "L5+L2" },
    ];
    const html = renderToStaticMarkup(createElement(OnScreenKeyboard, { next: "s", keys, layout: "free" }));
    expect(html).toContain('data-layout="free"');
    expect(html).toMatch(/osk-key osk-free-key on"[^>]*>S</);
    expect(html).toContain("Ctrl+C+");
    expect(html).toContain("左薬指（L4）");
    // 登録していないキーは「画面にないキー」
    expect(renderToStaticMarkup(createElement(OnScreenKeyboard, { next: "q", keys, layout: "free" }))).toContain(
      "このキーは画面のキーボードにありません",
    );
  });
});
