import { expect, mock, test } from "bun:test";
import { GoBackSignal } from "../../src/core/domain/navigation";
import { PushBranch } from "../../src/core/push-branch";
import { createGitMock } from "../mocks/git-client.mock";
import { createUIMock } from "../mocks/ui.mock";

const selectedRemote = { name: "review", url: "https://example.test/project" };

test("Sync leaves its local commit saved when HEAD moves before the publication preview", async () => {
  const git = createGitMock({ getRemotes: async () => [selectedRemote] });
  const ui = createUIMock();
  await new PushBranch(git, ui).run({ expectedHead: "c".repeat(40), setUpstream: true });
  expect(ui.error).toHaveBeenCalledWith(expect.stringContaining("HEAD changed after Sync"));
  expect(ui.info).toHaveBeenCalledWith(expect.stringContaining("saved locally"));
  expect(ui.askConfirm).not.toHaveBeenCalled();
  expect(git.pushBranch).not.toHaveBeenCalled();
});

test("Escape dismisses a remote preview and reports no transport error", async () => {
  const git = createGitMock({ getRemotes: async () => [selectedRemote] });
  const ui = createUIMock({
    askConfirm: async () => {
      throw new GoBackSignal();
    },
  });
  await expect(new PushBranch(git, ui).run()).rejects.toBeInstanceOf(GoBackSignal);
  expect(git.pushBranch).not.toHaveBeenCalled();
  expect(ui.error).not.toHaveBeenCalled();
});

test("a non-Error transport failure retains the native message", async () => {
  const git = createGitMock({
    getRemotes: async () => [selectedRemote],
    pushBranch: mock(async () => Promise.reject("transport disconnected")),
  });
  const ui = createUIMock({ askConfirm: async () => true });
  await new PushBranch(git, ui).run();
  expect(ui.error).toHaveBeenCalledWith(expect.stringContaining("transport disconnected"));
  expect(ui.success).not.toHaveBeenCalled();
});
