import type { CoverageMapData } from "istanbul-lib-coverage";
import { createInstrumenter } from "istanbul-lib-instrument";

export interface InstrumentationPlan {
  modules: Record<string, string>;
  baseline: CoverageMapData;
}

export function instrumentSources(
  sources: Iterable<readonly [string, string]>,
): InstrumentationPlan {
  const plan: InstrumentationPlan = { modules: {}, baseline: {} };
  for (const [path, source] of sources) {
    if (/\/\/[\t ]*istanbul ignore|\/\*[\s]*istanbul ignore/.test(source)) {
      throw new Error(`Coverage suppression is not allowed in ${path}`);
    }
    const instrumenter = createInstrumenter({
      esModules: true,
      coverageGlobalScope: "globalThis",
      coverageGlobalScopeFunc: false,
      parserPlugins: path.endsWith(".tsx") ? ["typescript", "jsx"] : ["typescript"],
    });
    plan.modules[path] = instrumenter.instrumentSync(source, path);
    plan.baseline[path] = instrumenter.lastFileCoverage();
  }
  return plan;
}
