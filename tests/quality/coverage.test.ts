import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import type { CoverageMapData } from "istanbul-lib-coverage";
import { coverageResults } from "../../scripts/quality/coverage-results";
import { instrumentSources } from "../../scripts/quality/instrumentation";

function measure(source: string): CoverageMapData {
  const context = { __coverage__: {} };
  const javascript = new Bun.Transpiler({ loader: "ts" }).transformSync(source);
  runInNewContext(javascript, context);
  return context.__coverage__;
}

test("coverage fails on a missing branch and a file that is never imported", () => {
  const plan = instrumentSources([
    ["/decision.ts", "function decide(pass: boolean) { return pass ? 1 : 0; } decide(true);"],
    ["/unused.ts", "function unused() { return 1; }"],
  ]);
  const result = coverageResults(plan.baseline, [measure(plan.modules["/decision.ts"]!)]);

  expect(result.complete).toBe(false);
  expect(result.totals.find(({ metric }) => metric === "branches")).toMatchObject({
    covered: 1,
    total: 2,
  });
  expect(result.files.find(({ file }) => file === "/unused.ts")?.metrics).toContainEqual(
    expect.objectContaining({ metric: "functions", total: 1, covered: 0 }),
  );
  const decision = result.files.find(({ file }) => file === "/decision.ts");
  expect(decision?.uncovered.branches).toEqual([
    expect.objectContaining({ line: 1, outcome: 1, type: "cond-expr" }),
  ]);
  const unused = result.files.find(({ file }) => file === "/unused.ts");
  expect(unused?.uncovered.functions).toEqual([{ line: 1, column: 10 }]);
});

test("coverage passes when both alternatives and every function execute", () => {
  const plan = instrumentSources([
    [
      "/decision.ts",
      "function decide(pass: boolean) { return pass ? 1 : 0; } decide(true); decide(false);",
    ],
  ]);
  expect(coverageResults(plan.baseline, [measure(plan.modules["/decision.ts"]!)]).complete).toBe(
    true,
  );
});

test("rejects coverage suppression", () => {
  expect(() =>
    instrumentSources([["/code.ts", "/* istanbul ignore next */ function skipped() {}"]]),
  ).toThrow("Coverage suppression is not allowed in /code.ts");
});

test("rejects wrong inventory and fabricated coverage counters", () => {
  const plan = instrumentSources([["/known.ts", "if (Boolean(true)) { String(1); }"]]);
  const unrelated = instrumentSources([["/another.ts", "String(2);"]]);
  expect(() =>
    coverageResults(plan.baseline, [measure(unrelated.modules["/another.ts"]!)]),
  ).toThrow("Unexpected coverage inventory");
  const counts = measure(plan.modules["/known.ts"]!);
  counts["/known.ts"]!.b["0"] = [-1];
  expect(() => coverageResults(plan.baseline, [counts])).toThrow("Invalid coverage counters");
});

test("instruments JSX expressions in TSX sources", () => {
  const { baseline } = instrumentSources([
    ["/component.tsx", "export const widget = (ready: boolean) => ready ? <div /> : null;"],
  ]);
  expect(Object.values(baseline["/component.tsx"]!.branchMap)).toHaveLength(1);
  expect(Object.values(baseline["/component.tsx"]!.fnMap)).toHaveLength(1);
});

test("reports a source location for an implicit else outcome", () => {
  const plan = instrumentSources([["/implicit.ts", "if (Boolean(true)) String(1);"]]);
  const result = coverageResults(plan.baseline, [measure(plan.modules["/implicit.ts"]!)]);
  expect(result.files[0]?.uncovered.branches).toEqual([
    { line: 1, column: 1, branch: "0", outcome: 1, type: "if" },
  ]);
});
