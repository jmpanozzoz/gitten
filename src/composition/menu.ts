import { GoBackSignal } from "../core/domain/navigation";
import type { IGitClient, RepoContext } from "../core/ports/git-client.port";
import type { IUI } from "../core/ports/ui.port";
import type { MenuActions } from "./actions";
import { type MainOption, type MoreOption, mainOptions, moreOptions } from "./menu-options";

export async function runMenu(
  git: IGitClient,
  ui: IUI,
  name: string,
  actions: MenuActions,
): Promise<void> {
  while (true) {
    ui.context(describeContext(name, await git.getRepoContext()));
    const choice = await pickAction(ui);
    if (choice === "exit") return;
    await dispatch(ui, choice, actions);
  }
}

async function dispatch(
  ui: IUI,
  choice: Exclude<MainOption | MoreOption, "exit">,
  actions: MenuActions,
): Promise<void> {
  try {
    const action = choice === "more" ? await ui.askSelect("More options:", moreOptions) : choice;
    await actions[action]();
  } catch (error) {
    if (error instanceof GoBackSignal) return;
    const reason = error instanceof Error ? error.message : String(error);
    ui.error(`Could not complete the action.\n${reason}`);
  }
}

async function pickAction(ui: IUI): Promise<MainOption | MoreOption> {
  try {
    return await ui.askSearchSelect<MainOption | MoreOption>(
      "What do you want to do?",
      mainOptions,
      moreOptions,
    );
  } catch (error) {
    if (error instanceof GoBackSignal) return "exit";
    throw error;
  }
}

function describeContext(name: string, context: RepoContext): string {
  const { branch, commitsAhead, commitsBehind, insertions, deletions, modifiedCount } = context;
  const parts = [`${name} · ${branch}`];
  if (commitsAhead > 0) parts.push(`${commitsAhead} ahead`);
  if (commitsBehind > 0) parts.push(`${commitsBehind} behind`);
  if (modifiedCount > 0) parts.push(`+${insertions} −${deletions} · ${modifiedCount} files`);
  return parts.join(" · ");
}
