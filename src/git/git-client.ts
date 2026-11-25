import type { IGitClient } from "../core/ports/git-client.port";
import { historyAPI } from "./history-api";
import { indexAPI } from "./index-api";
import { operationAPI } from "./operation-api";
import { purgeAPI } from "./purge-api";
import { remoteAPI } from "./remote-api";
import { repositoryAPI } from "./repository-api";
import { rewriteAPI } from "./rewrite-api";
import { stashAPI } from "./stash-api";
import { strictGit } from "./strict-git";

export function createGitClient(cwd = process.cwd()): IGitClient {
  return Object.assign(
    { git: strictGit(cwd), cwd },
    repositoryAPI,
    operationAPI,
    remoteAPI,
    indexAPI,
    historyAPI,
    rewriteAPI,
    stashAPI,
    purgeAPI,
  );
}
