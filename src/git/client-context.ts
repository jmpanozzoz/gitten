import type { SimpleGit } from "simple-git";
import type { IGitClient } from "../core/ports/git-client.port";

export interface GitContext extends IGitClient {
  git: SimpleGit;
  cwd: string;
}
