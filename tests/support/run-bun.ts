import { join } from "node:path";

export function bunCommand(args: string[]): string[] {
  const preload = join(import.meta.dir, "../../scripts/quality/coverage-child.ts");
  const coverageArgs = process.env.GITTEN_COVERAGE_SESSION ? ["--preload", preload] : [];
  return [process.execPath, "--no-env-file", ...coverageArgs, ...args];
}

export function runBun(args: string[], cwd: string, env: Record<string, string | undefined>) {
  return Bun.spawnSync(bunCommand(args), {
    cwd,
    env: { ...env, GITTEN_COVERAGE_SESSION: process.env.GITTEN_COVERAGE_SESSION },
  });
}
