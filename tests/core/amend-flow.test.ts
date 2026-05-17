import { test, expect, mock } from "bun:test";
import { AmendFlow } from "../../src/core/amend-flow";
import { createGitMock } from "../mocks/git-client.mock";
import { createUIMock } from "../mocks/ui.mock";

const LAST_COMMIT = { hash: "abc1234", message: "feat: original message" };

// ─── amend message only ────────────────────────────────────────────────────────

test("amends commit message when user selects message-only and types new message", async () => {
  const git = createGitMock({
    getLastCommit: mock(() => Promise.resolve(LAST_COMMIT)),
    amendCommit: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("message")),
    askText: mock(() => Promise.resolve("feat: updated message")),
  });

  await new AmendFlow(git, ui).run();

  expect(git.amendCommit).toHaveBeenCalledTimes(1);
  expect(git.amendCommit).toHaveBeenCalledWith("feat: updated message");
  expect(git.amendNoEdit).not.toHaveBeenCalled();
});

test("keeps original message when user clears the text input", async () => {
  const git = createGitMock({
    getLastCommit: mock(() => Promise.resolve(LAST_COMMIT)),
    amendCommit: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("message")),
    askText: mock(() => Promise.resolve("")),
  });

  await new AmendFlow(git, ui).run();

  expect(git.amendCommit).toHaveBeenCalledWith("feat: original message");
});

test("prefills the text input with the current commit message", async () => {
  const git = createGitMock({
    getLastCommit: mock(() => Promise.resolve(LAST_COMMIT)),
    amendCommit: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("message")),
    askText: mock(() => Promise.resolve("feat: updated message")),
  });

  await new AmendFlow(git, ui).run();

  const [, , initialValue] = (ui.askText as ReturnType<typeof mock>).mock.calls[0];
  expect(initialValue).toBe("feat: original message");
});

// ─── amend staged files only ───────────────────────────────────────────────────

test("calls amendNoEdit when user selects staged-only and files are staged", async () => {
  const git = createGitMock({
    getLastCommit: mock(() => Promise.resolve(LAST_COMMIT)),
    getStatus: mock(() =>
      Promise.resolve({ files: [{ path: "src/app.ts", status: "A" }], isClean: () => false, commitsAhead: 0, commitsBehind: 0 })
    ),
    amendNoEdit: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("staged")),
  });

  await new AmendFlow(git, ui).run();

  expect(git.amendNoEdit).toHaveBeenCalledTimes(1);
  expect(git.amendCommit).not.toHaveBeenCalled();
});

test("warns and aborts when user selects staged-only but nothing is staged", async () => {
  const git = createGitMock({
    getLastCommit: mock(() => Promise.resolve(LAST_COMMIT)),
    getStatus: mock(() =>
      Promise.resolve({ files: [], isClean: () => true, commitsAhead: 0, commitsBehind: 0 })
    ),
    amendNoEdit: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("staged")),
  });

  await new AmendFlow(git, ui).run();

  expect(git.amendNoEdit).not.toHaveBeenCalled();
  expect(ui.warn).toHaveBeenCalled();
});

// ─── amend both ───────────────────────────────────────────────────────────────

test("amends both staged files and message when user selects both", async () => {
  const git = createGitMock({
    getLastCommit: mock(() => Promise.resolve(LAST_COMMIT)),
    getStatus: mock(() =>
      Promise.resolve({ files: [{ path: "src/app.ts", status: "A" }], isClean: () => false, commitsAhead: 0, commitsBehind: 0 })
    ),
    amendCommit: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("both")),
    askText: mock(() => Promise.resolve("feat: both staged and message")),
  });

  await new AmendFlow(git, ui).run();

  expect(git.amendCommit).toHaveBeenCalledWith("feat: both staged and message");
  expect(git.amendNoEdit).not.toHaveBeenCalled();
});

test("warns and aborts both-mode when nothing is staged", async () => {
  const git = createGitMock({
    getLastCommit: mock(() => Promise.resolve(LAST_COMMIT)),
    getStatus: mock(() =>
      Promise.resolve({ files: [], isClean: () => true, commitsAhead: 0, commitsBehind: 0 })
    ),
    amendCommit: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("both")),
  });

  await new AmendFlow(git, ui).run();

  expect(git.amendCommit).not.toHaveBeenCalled();
  expect(ui.warn).toHaveBeenCalled();
});

// ─── success feedback ─────────────────────────────────────────────────────────

test("shows success message after amending", async () => {
  const git = createGitMock({
    getLastCommit: mock(() => Promise.resolve(LAST_COMMIT)),
    amendCommit: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("message")),
    askText: mock(() => Promise.resolve("feat: new message")),
  });

  await new AmendFlow(git, ui).run();

  expect(ui.success).toHaveBeenCalled();
});

// ─── empty repo guard ─────────────────────────────────────────────────────────

test("shows error and returns when repo has no commits", async () => {
  const git = createGitMock({
    getLastCommit: mock(() => Promise.reject(new Error("does not have any commits yet"))),
  });
  const ui = createUIMock();

  await new AmendFlow(git, ui).run();

  expect(ui.error).toHaveBeenCalledWith("No commits found — nothing to amend.");
  expect(git.amendCommit).not.toHaveBeenCalled();
  expect(git.amendNoEdit).not.toHaveBeenCalled();
});
