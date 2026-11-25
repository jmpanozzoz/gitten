import { expect, test } from "bun:test";
import { contractGaps } from "../../scripts/quality/contracts";
import { assertFullTestRun } from "../../scripts/quality/test-report";
import { assertUnfilteredSuite } from "../../scripts/quality/test-selection";

const REPORT =
  '<testsuites name="bun test" tests="2" failures="0" skipped="0">' +
  '<testsuite name="one" file="tests/one.test.ts" tests="1"><testcase file="tests/one.test.ts"/></testsuite>' +
  '<testsuite name="two" file="tests/two.test.ts" tests="1"><testcase file="tests/two.test.ts"/></testsuite>' +
  "</testsuites>";

test("accepts a successful report that includes every expected file", () => {
  expect(() => assertFullTestRun(REPORT, ["tests/one.test.ts", "tests/two.test.ts"])).not.toThrow();
});

test("rejects skipped tests even if the runner did not fail", () => {
  const skipped = REPORT.replace('skipped="0"', 'skipped="1"');
  expect(() => assertFullTestRun(skipped, ["tests/one.test.ts"])).toThrow("skipped");
});

test("rejects missing and empty test reports", () => {
  expect(() => assertFullTestRun(REPORT, ["tests/unexpected.test.ts"])).toThrow(
    "were not executed",
  );
  expect(() => assertFullTestRun("", ["tests/one.test.ts"])).toThrow("invalid");
});

test("rejects a declared count without matching executed cases", () => {
  const incomplete = REPORT.replace('tests="2"', 'tests="3"');
  expect(() => assertFullTestRun(incomplete, ["tests/one.test.ts"])).toThrow("every test case");
  expect(() => assertFullTestRun(REPORT, [])).toThrow("No test files found");
  const unnamed = REPORT.replace('<testcase file="tests/two.test.ts"/>', "<testcase/>");
  expect(() => assertFullTestRun(unnamed, ["tests/two.test.ts"])).toThrow("were not executed");
  const emptySuite = REPORT.replace('<testcase file="tests/two.test.ts"/>', "");
  expect(() => assertFullTestRun(emptySuite, ["tests/two.test.ts"])).toThrow("were not executed");
});

test("rejects focused and omitted cases before Bun can report an incomplete run as passing", () => {
  expect(() => assertUnfilteredSuite("suite.ts", 'test.only("one", () => {});')).toThrow(
    "suite.ts:1: only",
  );
  expect(() => assertUnfilteredSuite("suite.ts", 'trial["skip"]("one", () => {});')).toThrow(
    "suite.ts:1: skip",
  );
  expect(() => assertUnfilteredSuite("suite.ts", '// test.only("example")')).not.toThrow();
});

test("requires an executed case with assertions for every registered outcome", () => {
  const registry = {
    git: {
      success: ["test.ts", "creates a ref"] as const,
      failure: ["test.ts", "leaves the ref unchanged"] as const,
    },
  };
  const good = { file: "test.ts", name: "creates a ref", assertions: 1 };
  const weak = { file: "test.ts", name: "leaves the ref unchanged", assertions: 0 };
  expect(contractGaps([good, weak], registry)).toEqual([
    "git/failure · test.ts · leaves the ref unchanged",
  ]);
  expect(contractGaps([good, { ...weak, assertions: 1 }], registry)).toEqual([]);
  expect(contractGaps([])).toContainEqual(expect.stringContaining("git/sync/success"));
});
