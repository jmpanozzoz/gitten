import { test, expect, mock, beforeEach, afterEach, spyOn } from "bun:test";
import { suggestCommitMessage, suggestGitignorePatterns } from "../../src/core/ai-suggester";
import type { AIConfig } from "../../src/config/config";

const CONFIG: AIConfig = {
  enabled: true,
  baseUrl: "https://api.example.com/v1",
  apiKey: "sk-test",
  model: "gpt-4o-mini",
};

function mockFetch(content: string, ok = true) {
  return spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(
      JSON.stringify({ choices: [{ message: { content } }] }),
      { status: ok ? 200 : 401 }
    )
  );
}

afterEach(() => {
  mock.restore();
});

// ─── suggestCommitMessage ─────────────────────────────────────────────────────

test("returns suggested commit message from API", async () => {
  mockFetch("feat: add user authentication");

  const result = await suggestCommitMessage("diff --git a/src/auth.ts", CONFIG);

  expect(result).toBe("feat: add user authentication");
});

test("calls correct endpoint with model and messages", async () => {
  const spy = mockFetch("chore: update deps");

  await suggestCommitMessage("some diff", CONFIG);

  const [url, init] = spy.mock.calls[0] as [string, RequestInit];
  expect(url).toBe("https://api.example.com/v1/chat/completions");
  const body = JSON.parse(init.body as string);
  expect(body.model).toBe("gpt-4o-mini");
  expect(body.messages[0].role).toBe("system");
  expect(body.messages[1].role).toBe("user");
});

test("throws when API responds with non-ok status", async () => {
  mockFetch("", false);

  await expect(suggestCommitMessage("diff", CONFIG)).rejects.toThrow();
});

test("throws when fetch fails (network error)", async () => {
  spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("network error"));

  await expect(suggestCommitMessage("diff", CONFIG)).rejects.toThrow("Network error");
});

test("truncates diff longer than 6000 chars before sending", async () => {
  const spy = mockFetch("fix: stuff");
  const longDiff = "a".repeat(7000);

  await suggestCommitMessage(longDiff, CONFIG);

  const body = JSON.parse((spy.mock.calls[0] as [string, RequestInit])[1].body as string);
  const userContent = body.messages[1].content as string;
  expect(userContent).toContain("(truncated)");
  expect(userContent.length).toBeLessThan(7000);
});

// ─── suggestGitignorePatterns ─────────────────────────────────────────────────

test("returns list of suggested patterns", async () => {
  mockFetch(".env\n*.log\n.DS_Store");

  const result = await suggestGitignorePatterns(["src/app.ts", ".env"], [".gitkeep"], CONFIG);

  expect(result).toEqual([".env", "*.log", ".DS_Store"]);
});

test("returns empty array when API fails", async () => {
  mockFetch("", false);

  const result = await suggestGitignorePatterns([], [], CONFIG);

  expect(result).toEqual([]);
});

test("strips blank lines from suggestions", async () => {
  mockFetch(".env\n\n*.log\n");

  const result = await suggestGitignorePatterns([], [], CONFIG);

  expect(result).toEqual([".env", "*.log"]);
});
