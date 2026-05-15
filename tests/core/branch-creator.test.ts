import { test, expect, mock } from "bun:test";
import { BranchCreator } from "../../src/core/branch-creator";
import type { AIBranchSuggester } from "../../src/core/branch-creator";
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
    askText: mock()
      .mockResolvedValueOnce("user login")
      .mockResolvedValueOnce("feat/oauth-login"),
    askConfirm: mock(() => Promise.resolve(true)),
  });

  await new BranchCreator(git, ui, aiSuggester).run();

  const placeholder = (ui.askText as ReturnType<typeof mock>).mock.calls[1]?.[1] as string;
  expect(placeholder).toBe("feat/oauth-login");
});
