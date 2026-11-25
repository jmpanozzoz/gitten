import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function loadCoverageSession(directory: string | undefined): string {
  if (!directory)
    throw new Error("GITTEN_COVERAGE_SESSION must identify an instrumentation session.");
  const modules = JSON.parse(readFileSync(join(directory, "modules.json"), "utf8")) as Record<
    string,
    string
  >;
  const instrumentedPaths = Object.keys(modules).map((path) => RegExp.escape(path));
  const filter = new RegExp(`^(?:${instrumentedPaths.join("|")})$`);
  Bun.plugin({
    name: "gitten-coverage",
    setup(builder) {
      builder.onLoad({ filter }, ({ path }) => ({
        contents: modules[path]!,
        loader: path.endsWith(".tsx") ? "tsx" : "ts",
      }));
    },
  });
  return directory;
}

export function writeCounters(directory: string, name: string, counters: unknown): void {
  writeFileSync(join(directory, name), JSON.stringify(counters ?? {}));
}
