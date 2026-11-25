import { expect, test } from "bun:test";
import { fetchSource } from "../../src/git/refspec";

test("maps exact and wildcard tracking refs back to their actual remote branch", () => {
  expect(
    fetchSource("refs/remotes/review/issue/current", [
      "+refs/heads/feature/*:refs/remotes/review/*/current",
      "refs/heads/exact:refs/remotes/review/single",
    ]),
  ).toBe("refs/heads/feature/issue");
  expect(
    fetchSource("refs/remotes/review/single", ["refs/heads/exact:refs/remotes/review/single"]),
  ).toBe("refs/heads/exact");
});

test("refuses ambiguous, excluded and unmatched remote mappings", () => {
  const tracking = "refs/remotes/review/topic";
  const defaultMapping = "+refs/heads/*:refs/remotes/review/*";
  expect(
    fetchSource(tracking, [defaultMapping, "refs/heads/other:refs/remotes/review/topic"]),
  ).toBeNull();
  expect(
    fetchSource(tracking, [defaultMapping, "^refs/heads/to*", "refs/heads/complex"]),
  ).toBeNull();
  expect(fetchSource(tracking, ["+refs/heads/*:refs/remotes/origin/*"])).toBeNull();
});

test("keeps dollar signs literal when a wildcard matches a branch component", () => {
  expect(fetchSource("refs/remotes/review/$&", ["+refs/heads/team/*:refs/remotes/review/*"])).toBe(
    "refs/heads/team/$&",
  );
});
