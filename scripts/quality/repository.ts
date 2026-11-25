import { accessSync, constants, existsSync, statSync } from "node:fs";
import { join } from "node:path";

export const projectRoot = join(import.meta.dir, "../..");

export function executableFile(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

export function repositoryFiles(
  scope: readonly string[],
  includeUntracked = true,
  root = projectRoot,
): string[] {
  const selection = includeUntracked ? ["--others", "--exclude-standard"] : [];
  const result = Bun.spawnSync(
    ["git", "ls-files", "-z", "--cached", ...selection, "--", ...scope],
    { cwd: root },
  );
  if (!result.success) {
    throw new Error(result.stderr.toString() || "Could not read Git's file inventory.");
  }
  return [
    ...new Set(
      result.stdout
        .toString()
        .split("\0")
        .filter((file) => file && existsSync(join(root, file))),
    ),
  ];
}

export function executableTypeScript(path: string): boolean {
  return /\.(?:[cm]?ts|tsx)$/.test(path) && !/\.d\.[cm]?ts$/.test(path);
}

export function testFile(path: string): boolean {
  return /[._](?:test|spec)\.(?:[cm]?[jt]s|[jt]sx)$/.test(path);
}

export function testSource(path: string): boolean {
  return path.startsWith("tests/") || testFile(path);
}

export function productionTypeScriptFiles(root: string): string[] {
  return repositoryFiles([], true, root).filter(
    (file) => executableTypeScript(file) && !testSource(file),
  );
}
