import { expect, mock, test } from "bun:test";
import { AmendFlow } from "../../src/core/amend-flow";
import { createGitMock } from "../mocks/git-client.mock";
import { createUIMock } from "../mocks/ui.mock";

const LAST_COMMIT = { hash: "abc1234", message: "feat: original message" };

test("Amend leaves a pending operation untouched before previewing an edit", async () => {
  const git = createGitMock({ getInProgressOperation: async () => "rebase" });
  const ui = createUIMock();
  await new AmendFlow(git, ui).run();
  expect(ui.warn).toHaveBeenCalledWith("Finish the pending rebase before amending.");
  expect(ui.askSelect).not.toHaveBeenCalled();
  expect(git.amendCommit).not.toHaveBeenCalled();
});

test("declining Amend's staged preview leaves both the message and index unchanged", async () => {
  const git = createGitMock({
    getLastCommit: async () => LAST_COMMIT,
    getStagedDiff: async () => "+reviewed content",
  });
  const ui = createUIMock({ askSelect: async () => "both" });
  await new AmendFlow(git, ui).run();
  expect(ui.showDiff).toHaveBeenCalledWith("+reviewed content");
  expect(ui.askConfirm).toHaveBeenCalledWith("Amend with the displayed staged changes?", false);
  expect(git.amendNoEdit).not.toHaveBeenCalled();
  expect(git.amendCommit).not.toHaveBeenCalled();
});

test("Amend refuses a changed HEAD after editing the commit subject", async () => {
  const git = createGitMock({
    getLastCommit: mock()
      .mockResolvedValueOnce(LAST_COMMIT)
      .mockResolvedValue({ ...LAST_COMMIT, hash: "def789" }),
  });
  const ui = createUIMock({ askSelect: async () => "message", askText: async () => "new subject" });
  await new AmendFlow(git, ui).run();
  expect(ui.warn).toHaveBeenCalledWith(expect.stringContaining("branch or Git operation changed"));
  expect(git.amendCommit).not.toHaveBeenCalled();
  expect(ui.success).not.toHaveBeenCalled();
});

test("staged-only Amend stops if HEAD disappears after the diff was approved", async () => {
  const git = createGitMock({
    getLastCommit: mock()
      .mockResolvedValueOnce(LAST_COMMIT)
      .mockRejectedValue(new Error("no HEAD")),
    getStagedDiff: async () => "+approved diff",
  });
  const ui = createUIMock({ askSelect: async () => "staged", askConfirm: async () => true });
  await new AmendFlow(git, ui).run();
  expect(ui.showDiff).toHaveBeenCalledWith("+approved diff");
  expect(ui.warn).toHaveBeenCalledWith(expect.stringContaining("branch or Git operation changed"));
  expect(git.amendNoEdit).not.toHaveBeenCalled();
  expect(ui.success).not.toHaveBeenCalled();
});

test("Amend preserves the body and trailers when the AI returns no suggestion or an unknown error", async () => {
  const original = {
    ...LAST_COMMIT,
    body: "Longer body\n\nCo-authored-by: Test <test@example.invalid>",
  };
  const improve = mock().mockResolvedValueOnce("").mockRejectedValueOnce("offline");
  for (const failed of [false, true]) {
    const git = createGitMock({ getLastCommit: async () => original });
    const ui = createUIMock({
      askSelect: async () => "message",
      askConfirm: async () => true,
      askText: mock(async () => "new subject"),
    });
    await new AmendFlow(git, ui, improve).run();
    expect(ui.askText).toHaveBeenCalledWith("Commit subject:", undefined, original.message);
    expect(git.amendCommit).toHaveBeenCalledWith(`new subject\n\n${original.body}`, true);
    if (failed) expect(ui.warn).toHaveBeenCalledWith("AI failed: unknown error");
  }
  expect(improve).toHaveBeenCalledTimes(2);
});

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
  expect(git.amendCommit).toHaveBeenCalledWith("feat: updated message", true);
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

  expect(git.amendCommit).toHaveBeenCalledWith("feat: original message", true);
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

  const [, , initialValue] = (ui.askText as ReturnType<typeof mock>).mock.calls[0]!;
  expect(initialValue).toBe("feat: original message");
});

// ─── amend staged files only ───────────────────────────────────────────────────

test("calls amendNoEdit when user selects staged-only and files are staged", async () => {
  const git = createGitMock({
    getStagedDiff: async () => "+new staged content",
    getLastCommit: mock(() => Promise.resolve(LAST_COMMIT)),
    getStatus: mock(() =>
      Promise.resolve({
        files: [{ path: "src/app.ts", status: "A" }],
        isClean: () => false,
        commitsAhead: 0,
        commitsBehind: 0,
      }),
    ),
    amendNoEdit: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askConfirm: async () => true,
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
      Promise.resolve({
        files: [],
        isClean: () => true,
        commitsAhead: 0,
        commitsBehind: 0,
      }),
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
    getStagedDiff: async () => "+new staged content",
    getLastCommit: mock(() => Promise.resolve(LAST_COMMIT)),
    getStatus: mock(() =>
      Promise.resolve({
        files: [{ path: "src/app.ts", status: "A" }],
        isClean: () => false,
        commitsAhead: 0,
        commitsBehind: 0,
      }),
    ),
    amendCommit: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askConfirm: async () => true,
    askSelect: mock(() => Promise.resolve("both")),
    askText: mock(() => Promise.resolve("feat: both staged and message")),
  });

  await new AmendFlow(git, ui).run();

  expect(git.amendCommit).toHaveBeenCalledWith("feat: both staged and message", false);
  expect(git.amendNoEdit).not.toHaveBeenCalled();
});

test("warns and aborts both-mode when nothing is staged", async () => {
  const git = createGitMock({
    getLastCommit: mock(() => Promise.resolve(LAST_COMMIT)),
    getStatus: mock(() =>
      Promise.resolve({
        files: [],
        isClean: () => true,
        commitsAhead: 0,
        commitsBehind: 0,
      }),
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

// ─── protected branch warning ─────────────────────────────────────────────────

test("warns and aborts when amending on a protected branch and user declines", async () => {
  const git = createGitMock({
    getCurrentBranch: mock(() => Promise.resolve("main")),
  });
  const ui = createUIMock({ askConfirm: mock(() => Promise.resolve(false)) });

  await new AmendFlow(git, ui).run();

  expect(ui.askConfirm).toHaveBeenCalledWith(expect.stringContaining("main"));
  expect(git.getLastCommit).not.toHaveBeenCalled();
});

test("proceeds with amend when user confirms on protected branch", async () => {
  const git = createGitMock({
    getCurrentBranch: mock(() => Promise.resolve("main")),
    getLastCommit: mock(() => Promise.resolve(LAST_COMMIT)),
    amendCommit: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("message")),
    askConfirm: mock(() => Promise.resolve(true)),
    askText: mock(() => Promise.resolve("fix: hotfix")),
  });

  await new AmendFlow(git, ui).run();

  expect(git.amendCommit).toHaveBeenCalledWith("fix: hotfix", true);
});

// ─── AI message improvement ────────────────────────────────────────────────────

test("offers AI improvement and pre-fills suggestion when user accepts", async () => {
  const git = createGitMock({
    getLastCommit: mock(() => Promise.resolve(LAST_COMMIT)),
    amendCommit: mock(() => Promise.resolve()),
  });
  const aiSuggester = mock(() => Promise.resolve("feat: improve authentication flow"));
  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("message")),
    askConfirm: mock(() => Promise.resolve(true)),
    askText: mock(() => Promise.resolve("feat: improve authentication flow")),
  });

  await new AmendFlow(git, ui, aiSuggester).run();

  expect(aiSuggester).toHaveBeenCalledWith("feat: original message");
  expect(git.amendCommit).toHaveBeenCalledWith("feat: improve authentication flow", true);
});

test("skips AI and uses original message when user declines improvement", async () => {
  const git = createGitMock({
    getLastCommit: mock(() => Promise.resolve(LAST_COMMIT)),
    amendCommit: mock(() => Promise.resolve()),
  });
  const aiSuggester = mock(() => Promise.resolve("feat: ai suggestion"));
  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("message")),
    askConfirm: mock(() => Promise.resolve(false)),
    askText: mock(() => Promise.resolve("feat: manual message")),
  });

  await new AmendFlow(git, ui, aiSuggester).run();

  expect(aiSuggester).not.toHaveBeenCalled();
  expect(git.amendCommit).toHaveBeenCalledWith("feat: manual message", true);
});

test("falls back gracefully when AI suggester throws", async () => {
  const git = createGitMock({
    getLastCommit: mock(() => Promise.resolve(LAST_COMMIT)),
    amendCommit: mock(() => Promise.resolve()),
  });
  const aiSuggester = mock(() => Promise.reject(new Error("network timeout")));
  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("message")),
    askConfirm: mock(() => Promise.resolve(true)),
    askText: mock(() => Promise.resolve("feat: manual fallback")),
  });

  await new AmendFlow(git, ui, aiSuggester).run();

  expect(ui.warn).toHaveBeenCalledWith(expect.stringContaining("network timeout"));
  expect(git.amendCommit).toHaveBeenCalledWith("feat: manual fallback", true);
});

test("does not offer AI improvement when no aiSuggester provided", async () => {
  const git = createGitMock({
    getLastCommit: mock(() => Promise.resolve(LAST_COMMIT)),
    amendCommit: mock(() => Promise.resolve()),
  });
  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("message")),
    askText: mock(() => Promise.resolve("feat: no ai")),
  });

  await new AmendFlow(git, ui).run();

  expect(ui.askConfirm).not.toHaveBeenCalled();
  expect(git.amendCommit).toHaveBeenCalledWith("feat: no ai", true);
});
