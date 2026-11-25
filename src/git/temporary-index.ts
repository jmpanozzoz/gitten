import { isGuardedEnvKey } from "@simple-git/argv-parser";
import type { SimpleGit } from "simple-git";
import { strictGit } from "./strict-git";

export function gitWithIndex(root: string, index: string): SimpleGit {
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !isGuardedEnvKey(key)),
  );
  return strictGit({
    baseDir: root,
    config: ["core.abbrev=no"],
    allowConfig: ["core.abbrev"],
    allowEnvironment: ["GIT_INDEX_FILE"],
  }).env({ ...inherited, GIT_INDEX_FILE: index });
}

export async function commitWithIndex(
  git: SimpleGit,
  message: string,
  options: string[] = [],
): Promise<string | null> {
  const output = await git.raw(["commit", ...options, "--cleanup=verbatim", "-m", message]);
  // gitWithIndex disables abbreviation, including for repositories that use SHA-256.
  return output.match(/^\[[^\r\n]+ ([a-f\d]{40}(?:[a-f\d]{24})?)\]/m)?.[1] ?? null;
}
