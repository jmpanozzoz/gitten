import { type SimpleGit, type SimpleGitOptions, simpleGit } from "simple-git";

export function gitFailureDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function strictGit(location: string | Partial<SimpleGitOptions>): SimpleGit {
  const options = typeof location === "string" ? { baseDir: location } : location;
  return simpleGit({
    ...options,
    errors(error, result) {
      if (error || result.exitCode === 0) return error;
      const output = Buffer.concat([...result.stdOut, ...result.stdErr]);
      return output.length > 0 ? output : new Error(`Git exited with status ${result.exitCode}.`);
    },
  });
}
