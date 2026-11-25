import { basename } from "node:path";
import { version } from "../package.json";
import { createActions } from "./composition/actions";
import { runMenu } from "./composition/menu";
import { getActiveAIConfig } from "./config/config";
import { GoBackSignal } from "./core/domain/navigation";
import type { AIConfig } from "./core/domain/preferences";
import type { IGitClient } from "./core/ports/git-client.port";
import type { IUI } from "./core/ports/ui.port";
import { RemoteManager } from "./core/remote-manager";
import { createGitClient } from "./git/git-client";
import { UI } from "./ui/prompts";
import { checkForUpdate } from "./utils/update-checker";

export async function app(
  git: IGitClient = createGitClient(),
  ui: IUI = new UI(),
  fetchAIConfig: () => Promise<AIConfig | null> = getActiveAIConfig,
  checkUpdate: (v: string) => Promise<string | null> = checkForUpdate,
): Promise<number> {
  ui.intro("🐱 Gitten — Your Git assistant");

  const latestVersion = await checkUpdate(version);
  if (latestVersion) {
    ui.info(
      `Update available: v${latestVersion}. Get the release for your platform at https://github.com/jmpanozzoz/gitten/releases/latest`,
    );
  }

  if (!(await git.checkIsRepo())) return initializeRepository(git, ui);

  const hasLock = await git.hasIndexLock();
  if (hasLock) {
    ui.warn(
      "Git is using a locked index. Wait for the other Git operation to finish before retrying.",
    );
    return 1;
  }

  const root = await git.getRepositoryRoot();
  await runMenu(git, ui, basename(root), createActions(git, ui, root, fetchAIConfig));
  ui.outro("See you later! 👋");
  return 0;
}

async function initializeRepository(git: IGitClient, ui: IUI): Promise<number> {
  let initialize = false;
  try {
    initialize = await ui.askConfirm("No Git repository found here. Initialize one?");
  } catch (error) {
    if (!(error instanceof GoBackSignal)) throw error;
  }
  if (!initialize) {
    ui.outro("Repository initialization cancelled.");
    return 0;
  }

  const result = await new RemoteManager(git, ui).runInit();
  if (result.status === "remote-failed") {
    const reason = result.error instanceof Error ? result.error.message : String(result.error);
    ui.error(
      `Repository initialized. Remote setup failed. Check More → Remotes before retrying.\n${reason}`,
    );
    return 1;
  }
  if (result.status === "local-only") {
    ui.outro("Repository ready locally. You can link a remote from More → Remotes.");
  } else {
    ui.outro("Repository and remote ready. Run gitten again to manage your repo.");
  }
  return 0;
}
