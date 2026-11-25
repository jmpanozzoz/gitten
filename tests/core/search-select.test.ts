import { expect, test } from "bun:test";
import { fit, searchLines } from "../../src/ui/search-renderer";
import { matchingOptions, searchKey, searchState } from "../../src/ui/search-state";

test("searches Unicode and spaces, including options outside the main menu", () => {
  const state = searchState({
    message: "Actions",
    options: [{ value: "a", label: "Home" }],
    pool: [{ value: "b", label: "Café nuevo", hints: ["Read later"] }],
    multiple: false,
  });
  expect(matchingOptions(state).map(({ value }) => value)).toEqual(["a"]);
  searchKey(state, "CAFE\u0301 nuevo", {});
  expect(searchKey(state, "", { name: "return" })).toMatchObject({
    kind: "select",
    options: [{ value: "b" }],
  });
  searchKey(state, "🙈", {});
  searchKey(state, "", { name: "backspace" });
  expect(state.query).toBe("CAFE\u0301 nuevo");
  expect(searchKey(state, "", { name: "escape" })).toEqual({ kind: "cancel" });
});

test("Tab selects visible entries without losing earlier picks when the filter changes", () => {
  const options = [
    { value: "z", label: "Xylophone" },
    { value: "a", label: "Violin" },
  ];
  const state = searchState({ message: "Instruments", options, multiple: true });
  searchKey(state, "", { name: "down" });
  searchKey(state, "", { name: "tab" });
  searchKey(state, "Xylo", {});
  searchKey(state, "", { name: "tab" });
  expect(searchKey(state, "", { name: "enter" })).toEqual({ kind: "select", options });
  searchKey(state, "", { name: "tab" });
  expect(searchKey(state, "", { name: "enter" })).toEqual({
    kind: "select",
    options: [options[1]!],
  });
});

test("constrains narrow output without splitting a composed character", () => {
  const state = searchState({ message: "Actions menu", options: [], multiple: false });
  expect(searchLines(state, 5, 5).every((line) => Bun.stringWidth(line) <= 5)).toBe(true);
  expect(fit("e\u0301🙈X", 2)).toBe("e\u0301…");
  expect(fit("text", 0)).toBe("");
});

test("shows preceding results when the active match moves past the first page", () => {
  const options = Array.from({ length: 12 }, (_, i) => ({ label: `Branch ${i}`, value: i }));
  const state = searchState({ message: "Branches", options, multiple: false });
  for (let i = 0; i < 8; i++) searchKey(state, "", { name: "down" });
  const lines = searchLines(state, 80, 16).join("\n");
  expect(lines).toContain("↑ 4 more");
  expect(lines).toContain("Branch 8");
  expect(lines).not.toContain("Branch 0");
});

test("empty matches ignore Enter and Tab, and power keys leave the query intact", () => {
  const options = [{ value: "one", label: "First" }];
  const state = searchState({ message: "Actions", options, multiple: false });
  expect(searchKey(state, "", { name: "backspace" })).toBeUndefined();
  expect(searchKey(state, "", { name: "up" })).toBeUndefined();
  expect(state.cursor).toBe(0);
  searchKey(state, "unmatched", {});
  expect(searchKey(state, "", { name: "enter" })).toBeUndefined();
  expect(matchingOptions(state)).toEqual([]);

  const multiple = searchState({ message: "Actions", options, multiple: true });
  searchKey(multiple, "unmatched", {});
  expect(searchKey(multiple, "", { name: "tab" })).toBeUndefined();
  expect(multiple.checked.size).toBe(0);
  searchKey(multiple, "x", { meta: true });
  searchKey(multiple, "", {});
  searchKey(multiple, "\x01", {});
  expect(multiple.query).toBe("unmatched");
  expect(searchKey(multiple, "", { name: "c", ctrl: true })).toEqual({ kind: "cancel" });
});
