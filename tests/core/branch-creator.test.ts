import { expect, mock, test } from "bun:test";
import { BranchCreator } from "../../src/core/branch-creator";
import { GoBackSignal } from "../../src/core/domain/navigation";
import type { AIBranchSuggester } from "../../src/core/ports/ai.port";
import { createGitMock } from "../mocks/git-client.mock";
import { createUIMock } from "../mocks/ui.mock";

// ─── buildBranchName ────────────────────────────────────────────────────────

test("builds correct branch name from type and description", () => {
  const creator = new BranchCreator(createGitMock(), createUIMock());
  expect(creator.buildBranchName("feat", "Login de Usuario ")).toBe("feat/login-de-usuario");
  expect(creator.buildBranchName("fix", "  typo in Header  ")).toBe("fix/typo-in-header");
  expect(creator.buildBranchName("chore", "update deps")).toBe("chore/update-deps");
});

test("strips special characters from branch name", () => {
  const creator = new BranchCreator(createGitMock(), createUIMock());
  expect(creator.buildBranchName("feat", "auth (OAuth2.0)!")).toBe("feat/auth-oauth20");
});

// ─── branch prefixes ──────────────────────────────────────────────────────────

test("offers the default branch prefixes when none are configured", async () => {
  const askSelect = mock(() => Promise.resolve("feat"));
  const git = createGitMock({ branchExists: mock(() => Promise.resolve(false)) });
  const ui = createUIMock({
    askSelect,
    askText: mock(() => Promise.resolve("my feature")),
  });

  await new BranchCreator(git, ui).run();

  const offered = (askSelect.mock.calls[0] as unknown[])[1] as { value: string }[];
  expect(offered.map((o) => o.value)).toEqual(["feat", "fix", "hotfix", "chore", "docs"]);
});

// ─── without AI ─────────────────────────────────────────────────────────────

test("calls checkoutNewBranch with sanitized name when no AI configured", async () => {
  const git = createGitMock({
    branchExists: mock(() => Promise.resolve(false)),
  });
  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("feat" as never)),
    askText: mock(() => Promise.resolve("user authentication")),
  });

  await new BranchCreator(git, ui).run();

  expect(git.checkoutNewBranch).toHaveBeenCalledTimes(1);
  expect(git.checkoutNewBranch).toHaveBeenCalledWith("feat/user-authentication");
});

test("aborts and shows error if branch already exists", async () => {
  const git = createGitMock({
    branchExists: mock(() => Promise.resolve(true)),
  });
  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("feat" as never)),
    askText: mock(() => Promise.resolve("existing branch")),
  });

  await new BranchCreator(git, ui).run();

  expect(git.checkoutNewBranch).not.toHaveBeenCalled();
  expect(ui.error).toHaveBeenCalled();
});

test("loops on empty description until valid input", async () => {
  const git = createGitMock({
    branchExists: mock(() => Promise.resolve(false)),
  });
  const askText = mock()
    .mockResolvedValueOnce("")
    .mockResolvedValueOnce("   ")
    .mockResolvedValueOnce("valid description");
  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("fix" as never)),
    askText,
  });

  await new BranchCreator(git, ui).run();

  expect(askText).toHaveBeenCalledTimes(3);
  expect(git.checkoutNewBranch).toHaveBeenCalledWith("fix/valid-description");
});

// ─── with AI ─────────────────────────────────────────────────────────────────

test("does not ask AI confirmation when no suggester is provided", async () => {
  const git = createGitMock({ branchExists: mock(() => Promise.resolve(false)) });
  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("feat" as never)),
    askText: mock(() => Promise.resolve("user login")),
    askConfirm: mock(() => Promise.resolve(true)),
  });

  await new BranchCreator(git, ui).run();

  expect(ui.askConfirm).not.toHaveBeenCalled();
});

test("creates branch with AI suggestion when user accepts", async () => {
  const aiSuggester: AIBranchSuggester = mock(() => Promise.resolve("oauth-login"));
  const git = createGitMock({ branchExists: mock(() => Promise.resolve(false)) });
  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("feat" as never)),
    askText: mock()
      .mockResolvedValueOnce("add user auth with google oauth")
      .mockResolvedValueOnce("feat/oauth-login"),
    askConfirm: mock(() => Promise.resolve(true)),
  });

  await new BranchCreator(git, ui, aiSuggester).run();

  expect(aiSuggester).toHaveBeenCalledWith("feat", "add user auth with google oauth");
  expect(git.checkoutNewBranch).toHaveBeenCalledWith("feat/oauth-login");
});

test("uses deterministic name when user declines AI suggestion", async () => {
  const aiSuggester: AIBranchSuggester = mock(() => Promise.resolve("oauth-login"));
  const git = createGitMock({ branchExists: mock(() => Promise.resolve(false)) });
  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("feat" as never)),
    askText: mock(() => Promise.resolve("user login")),
    askConfirm: mock(() => Promise.resolve(false)),
  });

  await new BranchCreator(git, ui, aiSuggester).run();

  expect(aiSuggester).not.toHaveBeenCalled();
  expect(git.checkoutNewBranch).toHaveBeenCalledWith("feat/user-login");
});

test("falls back to deterministic name when AI returns null", async () => {
  const aiSuggester: AIBranchSuggester = mock(() => Promise.resolve(null));
  const git = createGitMock({ branchExists: mock(() => Promise.resolve(false)) });
  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("fix" as never)),
    askText: mock(() => Promise.resolve("null pointer crash")),
    askConfirm: mock(() => Promise.resolve(true)),
  });

  await new BranchCreator(git, ui, aiSuggester).run();

  expect(ui.warn).toHaveBeenCalled();
  expect(git.checkoutNewBranch).toHaveBeenCalledWith("fix/null-pointer-crash");
});

test("sanitizes AI suggestion before using it as branch name", async () => {
  const aiSuggester: AIBranchSuggester = mock(() => Promise.resolve("  OAuth Login!! "));
  const git = createGitMock({ branchExists: mock(() => Promise.resolve(false)) });
  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("feat" as never)),
    askText: mock().mockResolvedValueOnce("user login").mockResolvedValueOnce("feat/oauth-login"),
    askConfirm: mock(() => Promise.resolve(true)),
  });

  await new BranchCreator(git, ui, aiSuggester).run();

  const placeholder = (ui.askText as ReturnType<typeof mock>).mock.calls[1]?.[1] as string;
  expect(placeholder).toBe("feat/oauth-login");
});

// ─── AI suggestion collision ──────────────────────────────────────────────────

test("warns and lets user retry when AI-suggested name already exists", async () => {
  const aiSuggester: AIBranchSuggester = mock(() => Promise.resolve("existing-feature"));
  const git = createGitMock({
    branchExists: mock()
      .mockResolvedValueOnce(true) // AI suggestion exists
      .mockResolvedValueOnce(false), // user's edited name is free
  });
  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("feat" as never)),
    askText: mock()
      .mockResolvedValueOnce("my feature")
      .mockResolvedValueOnce("feat/existing-feature") // AI placeholder shown
      .mockResolvedValueOnce("feat/my-renamed-feature"), // user edits it
    askConfirm: mock(() => Promise.resolve(true)),
  });

  await new BranchCreator(git, ui, aiSuggester).run();

  expect(ui.warn).toHaveBeenCalled();
  expect(git.checkoutNewBranch).toHaveBeenCalledWith("feat/my-renamed-feature");
});

test("aborts without retry when no AI and branch already exists", async () => {
  const git = createGitMock({
    branchExists: mock(() => Promise.resolve(true)),
  });
  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("feat" as never)),
    askText: mock(() => Promise.resolve("existing branch")),
  });

  await new BranchCreator(git, ui).run();

  expect(ui.error).toHaveBeenCalled();
  expect(git.checkoutNewBranch).not.toHaveBeenCalled();
  // askText called only once (for description — no retry prompt)
  expect(ui.askText).toHaveBeenCalledTimes(1);
});

test("falls back locally when AI naming fails", async () => {
  const git = createGitMock();
  const ui = createUIMock({
    askSelect: async () => "feat",
    askText: async () => "Create fallback",
    askConfirm: async () => true,
  });
  await new BranchCreator(git, ui, async () => {
    throw new Error("offline");
  }).run();
  expect(git.checkoutNewBranch).toHaveBeenCalledWith("feat/create-fallback");
  expect(ui.warn).toHaveBeenCalledWith(expect.stringContaining("AI naming failed"));
});

test("retries an invalid AI-edited ref and only checks out the validated replacement", async () => {
  const git = createGitMock({ isValidBranchName: async (name) => name === "feat/validated" });
  const ui = createUIMock({
    askSelect: async () => "feat",
    askText: mock()
      .mockResolvedValueOnce("Some feature")
      .mockResolvedValueOnce("@{-1}")
      .mockResolvedValueOnce("feat/validated"),
    askConfirm: async () => true,
  });
  await new BranchCreator(git, ui, async () => "some-feature").run();
  expect(git.checkoutNewBranch).toHaveBeenCalledTimes(1);
  expect(git.checkoutNewBranch).toHaveBeenCalledWith("feat/validated");
});

test("keeps a custom branch prefix and defaults a blank edit to the sanitised suggestion", async () => {
  const git = createGitMock();
  const ui = createUIMock({
    askSelect: mock().mockResolvedValue("constructor"),
    askText: mock().mockResolvedValueOnce("Ticket").mockResolvedValueOnce(" "),
    askConfirm: mock().mockResolvedValue(true),
  });
  await new BranchCreator(git, ui, async () => "fix/Release Ticket", ["constructor"]).run();
  expect(ui.askSelect).toHaveBeenCalledWith("Branch type:", [
    { value: "constructor", label: "constructor" },
  ]);
  expect(git.checkoutNewBranch).toHaveBeenCalledWith("constructor/release-ticket");
});

test("retries repeated invalid and occupied names before creating a valid branch", async () => {
  const git = createGitMock({
    isValidBranchName: async (name) => ["feat/occupied", "feat/valid"].includes(name),
    branchExists: async (name) => name === "feat/occupied",
  });
  const ui = createUIMock({
    askSelect: mock().mockResolvedValue("feat"),
    askText: mock()
      .mockResolvedValueOnce("!!!")
      .mockResolvedValueOnce("also bad")
      .mockResolvedValueOnce("feat/occupied")
      .mockResolvedValueOnce("feat/valid"),
  });
  await new BranchCreator(git, ui).run();
  expect(ui.warn).toHaveBeenCalledWith('"also bad" is not a valid branch name.');
  expect(ui.warn).toHaveBeenCalledWith('Branch "feat/occupied" also already exists.');
  expect(git.checkoutNewBranch).toHaveBeenCalledTimes(1);
  expect(git.checkoutNewBranch).toHaveBeenCalledWith("feat/valid");
});

test("cancelling the AI suggestion leaves the current branch untouched", async () => {
  const git = createGitMock();
  const ui = createUIMock({
    askSelect: mock().mockResolvedValue("feat"),
    askText: mock().mockResolvedValue("Change"),
    askConfirm: mock().mockResolvedValue(true),
  });
  const cancel = new GoBackSignal();
  await expect(new BranchCreator(git, ui, mock().mockRejectedValue(cancel)).run()).rejects.toBe(
    cancel,
  );
  expect(git.checkoutNewBranch).not.toHaveBeenCalled();
});
