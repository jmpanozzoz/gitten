import { test, expect, mock } from "bun:test";
import { SyncFlow } from "../../src/core/sync-flow";
import { createGitMock } from "../mocks/git-client.mock";
import { createUIMock } from "../mocks/ui.mock";

const FILES = [{ path: "src/app.ts", status: "M" }];
const DIRTY_STATUS = { files: FILES, isClean: () => false, hasStagedChanges: () => false, commitsAhead: 0, commitsBehind: 0 };
const SELECT_ALL = { askMultiSelect: mock(() => Promise.resolve(["src/app.ts"])) };

function makeSyncFlow(aiSuggester?: (diff: string) => Promise<string | null>, gitOverrides = {}) {
  const git = createGitMock({
    getStatus: mock(() => Promise.resolve(DIRTY_STATUS)),
    addFiles: mock(() => Promise.resolve()),
    getStagedDiff: mock(() => Promise.resolve("diff --git a/src/app.ts")),
    commit: mock(() => Promise.resolve()),
    push: mock(() => Promise.resolve()),
    ...gitOverrides,
  });
  const ui = createUIMock({
    ...SELECT_ALL,
    askText: mock(() => Promise.resolve("feat: my commit")),
  });
  return { flow: new SyncFlow(git, ui, aiSuggester), git, ui };
}

test("uses AI suggestion as initialValue when user accepts", async () => {
  const aiSuggester = mock(() => Promise.resolve("feat: ai suggestion"));
  const { flow, git, ui } = makeSyncFlow(aiSuggester);
  (ui.askConfirm as ReturnType<typeof mock>).mockResolvedValueOnce(true);

  await flow.run();

  expect(aiSuggester).toHaveBeenCalledTimes(1);
  expect(git.getStagedDiff).toHaveBeenCalledTimes(2); // once for preview, once for AI suggestion
  const initialValue = (ui.askText as ReturnType<typeof mock>).mock.calls[0]![2];
  expect(initialValue).toBe("feat: ai suggestion");
});

test("skips AI and uses default initialValue when user declines AI prompt", async () => {
  const aiSuggester = mock(() => Promise.resolve("feat: ai suggestion"));
  const { flow, ui } = makeSyncFlow(aiSuggester);
  (ui.askConfirm as ReturnType<typeof mock>).mockResolvedValueOnce(false);

  await flow.run();

  expect(aiSuggester).not.toHaveBeenCalled();
  const initialValue = (ui.askText as ReturnType<typeof mock>).mock.calls[0]![2];
  expect(initialValue).toBe("chore: update");
});

test("falls back to default initialValue and warns when AI returns null", async () => {
  const aiSuggester = mock(() => Promise.resolve(null));
  const { flow, ui } = makeSyncFlow(aiSuggester);
  (ui.askConfirm as ReturnType<typeof mock>).mockResolvedValueOnce(true);

  await flow.run();

  expect(ui.warn).toHaveBeenCalled();
  const initialValue = (ui.askText as ReturnType<typeof mock>).mock.calls[0]![2];
  expect(initialValue).toBe("chore: update");
});

test("uses default initialValue and never prompts for AI when no aiSuggester provided", async () => {
  const aiSuggester = mock(() => Promise.resolve("feat: should not appear"));
  const { flow, ui } = makeSyncFlow(undefined);

  await flow.run();

  expect(aiSuggester).not.toHaveBeenCalled();
  const initialValue = (ui.askText as ReturnType<typeof mock>).mock.calls[0]![2];
  expect(initialValue).toBe("chore: update");
});
