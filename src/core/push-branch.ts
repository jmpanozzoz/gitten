import { GoBackSignal } from "./domain/navigation";
import type { BranchPushPlan, BranchPushPort } from "./ports/git-client.port";
import type { IUI } from "./ports/ui.port";
import { choosePushRemote, formatPushDestination } from "./push-destination";

interface PushOptions {
  expectedHead?: string;
  setUpstream?: boolean;
}

export class PushBranch {
  constructor(
    private readonly git: BranchPushPort,
    private readonly ui: IUI,
  ) {}

  async run(options: PushOptions = {}): Promise<void> {
    const remote = await choosePushRemote(this.ui, await this.git.getRemotes());
    if (!remote) {
      this.ui.warn("Add a remote before pushing.");
      return;
    }
    try {
      const plan = await this.git.previewBranchPush(remote);
      if (options.expectedHead && plan.head !== options.expectedHead) {
        throw new Error("HEAD changed after Sync created the commit.");
      }
      await this.confirmAndPublish(plan, options);
    } catch (error) {
      if (error instanceof GoBackSignal) throw error;
      const detail = error instanceof Error ? error.message : String(error);
      this.ui.error(`Push did not complete. Verify the destination before retrying.\n${detail}`);
      if (options.setUpstream)
        this.ui.info("Your commit is saved locally. Use Push Branch to retry.");
    }
  }

  private async confirmAndPublish(plan: BranchPushPlan, options: PushOptions): Promise<void> {
    const track = Boolean(options.setUpstream && !plan.upstreamRemote);
    const purpose = track ? " and set its upstream" : "";
    const destination = `${plan.remote}:${plan.destination}`;
    this.ui.info(
      `${plan.branch} at ${formatPushDestination(plan.head, plan.destination, plan.remote, plan.urls)}`,
    );
    if (!(await this.ui.askConfirm(`Push this commit to ${destination}${purpose}?`, false))) return;
    await this.ui.spin(`Pushing to ${destination}...`, () => this.git.pushBranch(plan, track));
    this.ui.success(`Pushed ${plan.head.slice(0, 12)} to ${destination}.`);
  }
}
