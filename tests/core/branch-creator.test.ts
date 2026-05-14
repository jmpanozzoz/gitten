import { test, expect, mock } from "bun:test";
import { BranchCreator } from "../../src/core/branch-creator";
import { createGitMock } from "../mocks/git-client.mock";
import { createUIMock } from "../mocks/ui.mock";

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

test("calls checkoutNewBranch with sanitized name", async () => {
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
