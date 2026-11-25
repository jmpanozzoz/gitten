export interface ExecutedCase {
  file: string;
  name: string;
  assertions: number;
}

export function assertFullTestRun(
  report: string,
  expectedFiles: readonly string[],
): ExecutedCase[] {
  const totals = report.match(/<testsuites\b([^>]*)>/)?.[1] ?? "";
  const total = Number(attribute(totals, "tests"));
  if (!passed(report, totals, total)) {
    throw new Error("Every test must pass. The test report is invalid, empty, failed, or skipped.");
  }
  if (expectedFiles.length === 0) throw new Error("No test files found in the repository.");
  const cases = executedCases(report);
  const files = new Set(cases.map(({ file }) => file));
  const missing = expectedFiles.filter((file) => !files.has(file));
  if (missing.length > 0) throw new Error(`Tests were not executed in ${missing.join(", ")}`);
  if (cases.length !== total)
    throw new Error("The test report does not account for every test case.");
  return cases;
}

function passed(report: string, totals: string, total: number): boolean {
  return (
    Number.isSafeInteger(total) &&
    total > 0 &&
    attribute(totals, "failures") === "0" &&
    attribute(totals, "skipped") === "0" &&
    !/<(failure|error|skipped)\b/.test(report)
  );
}

function executedCases(report: string): ExecutedCase[] {
  const cases: ExecutedCase[] = [];
  for (const match of report.matchAll(/<testcase\b([^>]*)>/g)) {
    const attributes = match[1]!;
    const file = attribute(attributes, "file")?.replaceAll("\\", "/");
    if (!file) continue;
    cases.push({
      file,
      name: attribute(attributes, "name") ?? "",
      assertions: Number(attribute(attributes, "assertions") ?? 0),
    });
  }
  return cases;
}

function attribute(tag: string, name: string): string | undefined {
  const raw = tag.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`))?.[1];
  return raw
    ?.replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}
