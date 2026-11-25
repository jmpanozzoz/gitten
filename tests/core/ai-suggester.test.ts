import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { bindAI } from "../../src/ai/bind";
import {
  reviewStagedDiff,
  suggestCommitMessage,
  suggestGitignorePatterns,
  testAIConnection,
} from "../../src/ai/suggester";
import type { AIConfig } from "../../src/core/domain/preferences";

const CONFIG: AIConfig = {
  enabled: true,
  provider: "openai",
  baseUrl: "https://api.example.com/v1",
  apiKey: "sk-test",
  model: "gpt-4o-mini",
};

function mockFetch(content: string, ok = true) {
  return spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
      status: ok ? 200 : 401,
    }),
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
  expect(init.redirect).toBe("manual");
  expect(new Headers(init.headers).get("authorization")).toBe("Bearer sk-test");
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

test("reports an AI rejection separately from an empty ignore suggestion", async () => {
  mockFetch("", false);
  await expect(suggestGitignorePatterns([], [], CONFIG)).rejects.toThrow("Invalid API key");
  mockFetch(" ");
  await expect(suggestGitignorePatterns([], [], CONFIG)).resolves.toEqual([]);
});

test("strips blank lines from suggestions", async () => {
  mockFetch(".env\n\n*.log\n");

  const result = await suggestGitignorePatterns([], [], CONFIG);

  expect(result).toEqual([".env", "*.log"]);
});

// ─── error classification ─────────────────────────────────────────────────────

test("throws user-friendly message on 401 without response body", async () => {
  spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("{}", { status: 401 }));

  await expect(suggestCommitMessage("diff", CONFIG)).rejects.toThrow("Invalid API key");
});

test("throws user-friendly message on 429 rate limit", async () => {
  spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("{}", { status: 429 }));

  await expect(suggestCommitMessage("diff", CONFIG)).rejects.toThrow("Rate limit");
});

test("does not surface untrusted provider response text in diagnostics", async () => {
  spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(JSON.stringify({ error: { message: "The model gpt-99 does not exist" } }), {
      status: 404,
    }),
  );

  await expect(suggestCommitMessage("diff", CONFIG)).rejects.toThrow("Model not found");
});

test("throws timeout error when fetch throws AbortError", async () => {
  const abortErr = new Error("The operation was aborted");
  abortErr.name = "AbortError";
  spyOn(globalThis, "fetch").mockRejectedValueOnce(abortErr);

  await expect(suggestCommitMessage("diff", CONFIG)).rejects.toThrow("timed out");
});

// ─── testAIConnection ─────────────────────────────────────────────────────────

test("testAIConnection resolves when API returns a valid response", async () => {
  mockFetch("OK");

  await expect(testAIConnection(CONFIG)).resolves.toBeUndefined();
});

test("testAIConnection throws when API responds with error status", async () => {
  spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("{}", { status: 401 }));

  await expect(testAIConnection(CONFIG)).rejects.toThrow("Invalid API key");
});

test("testAIConnection throws on network failure", async () => {
  spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("connection refused"));

  await expect(testAIConnection(CONFIG)).rejects.toThrow("Network error");
});

test("omits authorization when no key is configured", async () => {
  const fetch = mockFetch("OK");
  await testAIConnection({ ...CONFIG, apiKey: "" });
  const [, init] = fetch.mock.calls[0] as [string, RequestInit];
  expect(new Headers(init.headers).has("authorization")).toBe(false);
});

test("empty and invalid replies cannot pass a connection test", async () => {
  mockFetch("");
  await expect(testAIConnection(CONFIG)).rejects.toThrow("expected test response");
  spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("{"));
  await expect(testAIConnection(CONFIG)).rejects.toThrow("invalid JSON");
});

test("AI review distinguishes a clean review from a failed request", async () => {
  mockFetch("OK");
  await expect(reviewStagedDiff("diff", CONFIG)).resolves.toEqual([]);
  mockFetch("", false);
  await expect(reviewStagedDiff("diff", CONFIG)).rejects.toThrow("Invalid API key");
});

test("rejects a response above the size limit", async () => {
  mockFetch("a".repeat(128 * 1024));
  await expect(testAIConnection(CONFIG)).rejects.toThrow("size limit");
});

test("rejects sensitive diffs before contacting the provider, even beyond the truncation point", async () => {
  const fetch = spyOn(globalThis, "fetch");
  const diff = `${"sample content\n".repeat(500)}diff --git a/.env.example b/.env.example\n+placeholder`;
  await expect(suggestCommitMessage(diff, CONFIG)).rejects.toThrow("contain sensitive data");
  expect(fetch).not.toHaveBeenCalled();
});

test("AI actions share only their documented inputs with the connection bound for consent", async () => {
  const config = { ...CONFIG };
  const actions = bindAI(config);
  config.baseUrl = "https://other.example.test/v1";
  config.apiKey = "different-test-key";
  const network = spyOn(globalThis, "fetch");
  const steps = [
    {
      run: () => actions.amend("initial subject"),
      input: "Existing message: initial subject",
      response: "fix: edit",
      expected: "fix: edit",
      tokens: 120,
    },
    {
      run: () => actions.branch("feat", "local plan"),
      input: "Type: feat\nDescription: local plan",
      response: "local-plan",
      expected: "local-plan",
      tokens: 60,
    },
    {
      run: () => actions.commit("+local change"),
      input: "Staged diff:\n```\n+local change\n```",
      response: "feat: add",
      expected: "feat: add",
      tokens: 120,
    },
    {
      run: () => actions.conflict("+conflicting edit"),
      input: "Conflict diff:\n```\n+conflicting edit\n```",
      response: "Both sides edited the line",
      expected: "Both sides edited the line",
      tokens: 200,
    },
    {
      run: () => actions.explain("+one revision"),
      input: "Commit diff:\n```\n+one revision\n```",
      response: "Adds a revision",
      expected: "Adds a revision",
      tokens: 80,
    },
    {
      run: () => actions.gitignore(["file.ts"], ["dist/"]),
      input: "Tracked files:\nfile.ts\n\nCurrent .gitignore:\ndist/",
      response: "cache/",
      expected: ["cache/"],
      tokens: 300,
    },
    {
      run: () => actions.review("+example"),
      input: "Staged diff:\n```\n+example\n```",
      response: " missing validation \n\n check bounds ",
      expected: ["missing validation", "check bounds"],
      tokens: 500,
    },
    {
      run: () => actions.summarize(["feat: first", "fix: second"]),
      input: "Commit messages:\n1. feat: first\n2. fix: second",
      response: "• updates behavior",
      expected: "• updates behavior",
      tokens: 200,
    },
  ];
  for (const { run, input, response, expected, tokens } of steps) {
    network.mockResolvedValueOnce(Response.json({ choices: [{ message: { content: response } }] }));
    expect(await run()).toEqual(expected);
    const [url, init] = network.mock.calls.at(-1) as [string, RequestInit];
    expect(url).toBe(`${CONFIG.baseUrl}/chat/completions`);
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer sk-test");
    expect(JSON.parse(init.body as string)).toMatchObject({
      model: CONFIG.model,
      max_tokens: tokens,
      messages: [
        { role: "system", content: expect.any(String) },
        { role: "user", content: input },
      ],
    });
  }
  expect(network).toHaveBeenCalledTimes(steps.length);
  expect(Object.values(actions).every(({ destination }) => destination === CONFIG.baseUrl)).toBe(
    true,
  );
});

test("disabled AI and invalid endpoints block suggestions before sending any data", async () => {
  const network = spyOn(globalThis, "fetch").mockRejectedValue(
    new Error("Unexpected network request"),
  );
  await expect(suggestCommitMessage("private diff", { ...CONFIG, enabled: false })).rejects.toThrow(
    "disabled",
  );
  await expect(
    suggestCommitMessage("private diff", { ...CONFIG, baseUrl: "http://example.invalid" }),
  ).rejects.toThrow("Invalid AI endpoint");
  expect(network).not.toHaveBeenCalled();
});

test("stream cleanup failures preserve the provider status and response-size diagnostics", async () => {
  const network = spyOn(globalThis, "fetch").mockRejectedValue(
    new Error("Unexpected network request"),
  );
  const rejected = new Response("test body", { status: 403 });
  const lock = rejected.body!.getReader();
  try {
    network.mockResolvedValueOnce(rejected);
    await expect(testAIConnection(CONFIG)).rejects.toThrow("Access denied");
  } finally {
    lock.releaseLock();
  }
  const excess = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(128 * 1024 + 1));
    },
    cancel() {
      throw new Error("test stream refused cleanup");
    },
  });
  network.mockResolvedValueOnce(new Response(excess));
  await expect(testAIConnection(CONFIG)).rejects.toThrow("size limit");
});

test("an explicit connection test sends only its fixed message even while suggestions are disabled", async () => {
  const network = mockFetch("OK");
  await testAIConnection({ ...CONFIG, enabled: false });
  const [, init] = network.mock.calls[0] as [string, RequestInit];
  expect(JSON.parse(init.body as string).messages).toEqual([
    { role: "system", content: "Reply with exactly: OK" },
    { role: "user", content: "Test" },
  ]);
});

test("provider redirects and HTTP failures do not forward the request or expose remote error text", async () => {
  const network = spyOn(globalThis, "fetch");
  for (const [status, detail] of [
    [302, "redirected"],
    [403, "Access denied"],
    [500, "Provider error (500)"],
    [502, "Provider error (502)"],
    [503, "Provider error (503)"],
    [418, "HTTP 418"],
  ] as const) {
    network.mockResolvedValueOnce(
      new Response(null, { status, headers: { location: "https://other.example.test" } }),
    );
    await expect(testAIConnection(CONFIG)).rejects.toThrow(detail);
  }
  expect(network).toHaveBeenCalledTimes(6);
  expect(
    network.mock.calls.every(
      ([url, init]) => url === `${CONFIG.baseUrl}/chat/completions` && init?.redirect === "manual",
    ),
  ).toBe(true);
});

test("a review rejects empty, malformed and error-shaped replies without a clean result", async () => {
  const network = spyOn(globalThis, "fetch");
  network.mockResolvedValueOnce(new Response(null, { status: 204 }));
  await expect(reviewStagedDiff("diff", CONFIG)).rejects.toThrow("empty response body");
  network.mockResolvedValueOnce(Response.json({ error: "test-only sensitive error" }));
  await expect(reviewStagedDiff("diff", CONFIG)).rejects.toThrow(/^AI provider returned an error$/);
  network.mockResolvedValueOnce(Response.json({ choices: [{ message: { content: {} } }] }));
  await expect(reviewStagedDiff("diff", CONFIG)).rejects.toThrow("invalid response");
  mockFetch(" ");
  await expect(reviewStagedDiff("diff", CONFIG)).rejects.toThrow("empty review");
});

test("the AI timer covers both obtaining headers and reading a stalled response body", async () => {
  const realSetTimeout = globalThis.setTimeout;
  spyOn(globalThis, "setTimeout").mockImplementation(
    new Proxy(realSetTimeout, {
      apply(timer, receiver, args) {
        if (args[1] === 20_000) args[1] = 0;
        return Reflect.apply(timer, receiver, args);
      },
    }),
  );
  const { preconnect } = globalThis.fetch;
  const withFetchShape = (run: (...args: Parameters<typeof fetch>) => Promise<Response>) =>
    Object.assign(run, { preconnect });
  const network = spyOn(globalThis, "fetch");
  const aborted = () => new DOMException("aborted", "AbortError");
  network.mockImplementationOnce(
    withFetchShape(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(aborted()), { once: true });
        }),
    ),
  );
  await expect(testAIConnection(CONFIG)).rejects.toThrow("AI request timed out after 20s");
  network.mockImplementationOnce(
    withFetchShape(
      async (_url, init) =>
        new Response(
          new ReadableStream({
            start(controller) {
              init?.signal?.addEventListener("abort", () => controller.error(aborted()), {
                once: true,
              });
            },
          }),
        ),
    ),
  );
  await expect(testAIConnection(CONFIG)).rejects.toThrow("AI request timed out after 20s");
});
