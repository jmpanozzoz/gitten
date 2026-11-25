import {
  type CoverageMapData,
  createCoverageMap,
  type FileCoverage,
  type FileCoverageData,
  type Location,
} from "istanbul-lib-coverage";

const METRICS = ["lines", "functions", "statements", "branches"] as const;

export function coverageResults(baseline: CoverageMapData, measurements: CoverageMapData[]) {
  const coverage = createCoverageMap(baseline);
  for (const measurement of measurements) {
    verifyMeasurement(baseline, measurement);
    coverage.merge(measurement);
  }

  const summary = coverage.getCoverageSummary();
  const totals = METRICS.map((metric) => ({ metric, ...summary[metric] }));
  const files = coverage
    .files()
    .sort()
    .map((file) => {
      const counters = coverage.fileCoverageFor(file);
      const summary = counters.toSummary();
      return {
        file,
        metrics: METRICS.map((metric) => ({ metric, ...summary[metric] })),
        uncovered: uncoveredLocations(counters),
      };
    });
  return {
    totals,
    files,
    complete:
      files.length > 0 &&
      files.every(({ metrics }) =>
        metrics.every(({ total, covered, skipped }) => total === covered && skipped === 0),
      ),
  };
}

function verifyMeasurement(baseline: CoverageMapData, measurement: CoverageMapData): void {
  for (const [path, recorded] of Object.entries(measurement)) {
    const expected = baseline[path];
    if (!expected || recorded.path !== path || !sameCoverageLocations(expected, recorded)) {
      throw new Error(`Unexpected coverage inventory for ${path}`);
    }
    if (!validCounts(expected, recorded)) throw new Error(`Invalid coverage counters for ${path}`);
  }
}

function sameCoverageLocations(expected: FileCoverageData, recorded: FileCoverageData): boolean {
  return (["statementMap", "fnMap", "branchMap"] as const).every(
    (metric) => JSON.stringify(expected[metric]) === JSON.stringify(recorded[metric]),
  );
}

function validCounts(expected: FileCoverageData, recorded: FileCoverageData): boolean {
  const valid = (count: number) => Number.isSafeInteger(count) && count >= 0;
  const scalar = (["s", "f"] as const).every(
    (metric) =>
      Object.keys(expected[metric]).length === Object.keys(recorded[metric]).length &&
      Object.keys(expected[metric]).every((key) => valid(recorded[metric][key]!)),
  );
  return (
    scalar &&
    Object.keys(expected.b).length === Object.keys(recorded.b).length &&
    Object.entries(expected.b).every(([key, expectedBranches]) => {
      const branches = recorded.b[key];
      return branches?.length === expectedBranches.length && branches.every(valid);
    })
  );
}

function uncoveredLocations(counters: FileCoverage) {
  const branches = Object.entries(counters.b).flatMap(([id, hits]) =>
    hits.flatMap((hit, index) => {
      if (hit !== 0) return [];
      const branch = counters.branchMap[id]!;
      const candidate = branch.locations[index]?.start;
      const location = candidate?.line === undefined ? branch.loc.start : candidate;
      return [{ ...position(location), branch: id, outcome: index, type: branch.type }];
    }),
  );
  return {
    lines: counters.getUncoveredLines().map(Number),
    statements: Object.keys(counters.s)
      .filter((id) => counters.s[id] === 0)
      .map((id) => position(counters.statementMap[id]!.start)),
    functions: Object.keys(counters.f)
      .filter((id) => counters.f[id] === 0)
      .map((id) => position(counters.fnMap[id]!.decl.start)),
    branches,
  };
}

function position(location: Location) {
  return { line: location.line, column: location.column + 1 };
}
