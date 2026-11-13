import { describe, expect, it } from "vitest";
import { nextSyllable } from "./romaji";

describe("次に打つかなのローマ字", () => {
  it("ひらがな・カタカナ・小さい文字の組み合わせ・長音", () => {
    expect(nextSyllable("コンピュータ", 0)).toEqual({ kana: "コ", romaji: "ko" });
    expect(nextSyllable("コンピュータ", 1)).toEqual({ kana: "ン", romaji: "nn" });
    expect(nextSyllable("コンピュータ", 2)).toEqual({ kana: "ピュ", romaji: "pyu" });
    expect(nextSyllable("コンピュータ", 4)).toEqual({ kana: "ー", romaji: "-" });
    expect(nextSyllable("しゃしん", 0)).toEqual({ kana: "しゃ", romaji: "sha" });
  });
  it("っ は次の子音を重ねる。句読点は記号のキー", () => {
    expect(nextSyllable("きっぷ", 1)).toEqual({ kana: "っぷ", romaji: "ppu" });
    expect(nextSyllable("はい。", 2)).toEqual({ kana: "。", romaji: "." });
  });
  it("漢字・終わりは null", () => {
    expect(nextSyllable("日本", 0)).toBeNull();
    expect(nextSyllable("あ", 1)).toBeNull();
  });
});
