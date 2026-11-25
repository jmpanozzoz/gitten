import { redactRemoteCredentials } from "./domain/remote-display";
import type { Remote } from "./ports/git-client.port";
import type { IUI } from "./ports/ui.port";

export async function choosePushRemote(ui: IUI, remotes: Remote[]): Promise<string | undefined> {
  if (remotes.length === 0) return;
  if (remotes.length === 1) return remotes[0]!.name;
  return ui.askSelect(
    "Push to which remote?",
    remotes.map(({ name }) => ({ value: name, label: name })),
  );
}

export function formatPushDestination(
  oid: string,
  ref: string,
  remote: string,
  urls: string[],
): string {
  return `${oid.slice(0, 12)} → ${remote}:${ref}\n${urls.map(redactRemoteCredentials).join("\n")}`;
}
