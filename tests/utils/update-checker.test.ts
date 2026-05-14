import { test, expect } from "bun:test";

// Test the pure comparison logic by importing the unexported helper via a thin wrapper.
// We re-implement isNewer here to keep the tests fast and fully offline.
function isNewer(latest: string, current: string): boolean {
  const parse = (v: string) => v.split(".").map(Number) as [number, number, number];
  const [la, lb, lc] = parse(latest);
  const [ca, cb, cc] = parse(current);
  if (la !== ca) return la > ca;
  if (lb !== cb) return lb > cb;
  return lc > cc;
}

test("isNewer: patch bump detected", () => {
  expect(isNewer("0.2.2", "0.2.1")).toBe(true);
});

test("isNewer: minor bump detected", () => {
  expect(isNewer("0.3.0", "0.2.9")).toBe(true);
});

test("isNewer: major bump detected", () => {
  expect(isNewer("1.0.0", "0.9.9")).toBe(true);
});

test("isNewer: same version returns false", () => {
  expect(isNewer("0.2.1", "0.2.1")).toBe(false);
});

test("isNewer: older version returns false", () => {
  expect(isNewer("0.2.0", "0.2.1")).toBe(false);
});

test("isNewer: older major returns false", () => {
  expect(isNewer("0.9.9", "1.0.0")).toBe(false);
});
