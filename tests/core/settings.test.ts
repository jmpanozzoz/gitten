import { expect, mock, test } from "bun:test";
import { Settings } from "../../src/core/settings";
import { GoBackSignal } from "../../src/ui/go-back";
import { createUIMock } from "../mocks/ui.mock";

const MOCK_READ = mock(() => Promise.resolve({}));
const MOCK_WRITE = mock(() => Promise.resolve());
const MOCK_TEST_CONNECTION = mock(() => Promise.resolve());

mock.module("../../src/config/config", () => ({
  readConfig: MOCK_READ,
  writeConfig: MOCK_WRITE,
  getActiveAIConfig: mock(() => Promise.resolve(null)),
  getLimits: mock(() => ({
    undoCommitLimit: 10,
    cherryPickLogLimit: 30,
    bisectLogLimit: 30,
    revertLogLimit: 30,
  })),
  DEFAULT_LIMITS: {
    undoCommitLimit: 10,
    cherryPickLogLimit: 30,
    bisectLogLimit: 30,
    revertLogLimit: 30,
  },
}));

mock.module("../../src/core/ai-suggester", () => ({
  testAIConnection: MOCK_TEST_CONNECTION,
}));

// ─── top-level menu ───────────────────────────────────────────────────────────

test("propagates GoBackSignal when user presses ESC on top-level menu", async () => {
  MOCK_WRITE.mockClear();
  const ui = createUIMock({
    askSelect: mock(() => Promise.reject(new GoBackSignal())),
  });

  await expect(new Settings(ui).run()).rejects.toBeInstanceOf(GoBackSignal);
  expect(MOCK_WRITE).not.toHaveBeenCalled();
});

// ─── configure ────────────────────────────────────────────────────────────────

test("saves full config when user fills in all fields (openai provider)", async () => {
  const ui = createUIMock({
    askSelect: mock()
      .mockResolvedValueOnce("ai") // top-level menu
      .mockResolvedValueOnce("configure") // ai action
      .mockResolvedValueOnce("openai"), // provider
    askText: mock()
      .mockResolvedValueOnce("gpt-4o-mini") // model
      .mockResolvedValueOnce("sk-test-key"), // api key
    askConfirm: mock(() => Promise.resolve(true)),
  });

  await new Settings(ui).run();

  expect(MOCK_WRITE).toHaveBeenCalledWith(
    expect.objectContaining({
      ai: expect.objectContaining({
        provider: "openai",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "sk-test-key",
        model: "gpt-4o-mini",
        enabled: true,
      }),
    }),
  );
});

test("keeps the existing API key when left blank and never displays it in full", async () => {
  MOCK_WRITE.mockClear();
  MOCK_READ.mockResolvedValueOnce({
    ai: {
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-secret-1234567890",
      model: "gpt-4o-mini",
      enabled: true,
    },
  });

  const ui = createUIMock({
    askSelect: mock()
      .mockResolvedValueOnce("ai") // top-level menu
      .mockResolvedValueOnce("configure") // ai action
      .mockResolvedValueOnce("openai"), // provider
    askText: mock()
      .mockResolvedValueOnce("gpt-4o-mini") // model
      .mockResolvedValueOnce("   "), // API key left blank → keep existing
    askConfirm: mock(() => Promise.resolve(false)),
  });

  await new Settings(ui).run();

  // The stored key is preserved untouched.
  expect(MOCK_WRITE).toHaveBeenCalledWith(
    expect.objectContaining({
      ai: expect.objectContaining({ apiKey: "sk-secret-1234567890" }),
    }),
  );

  // The key is only ever shown masked — the full secret must never be printed.
  const infoOutput = (ui.info as ReturnType<typeof mock>).mock.calls
    .map((c) => String(c[0]))
    .join("\n");
  expect(infoOutput).toContain("sk-…7890");
  expect(infoOutput).not.toContain("sk-secret-1234567890");

  // And it must never be pre-filled into the prompt as an initial value.
  for (const call of (ui.askText as ReturnType<typeof mock>).mock.calls) {
    expect(call[2]).not.toBe("sk-secret-1234567890");
  }
});

test("saves config without API key for Ollama (local, no key required)", async () => {
  const ui = createUIMock({
    askSelect: mock()
      .mockResolvedValueOnce("ai")
      .mockResolvedValueOnce("configure")
      .mockResolvedValueOnce("ollama"),
    askText: mock().mockResolvedValueOnce("llama3.2"),
    askConfirm: mock(() => Promise.resolve(true)),
  });

  await new Settings(ui).run();

  expect(MOCK_WRITE).toHaveBeenCalledWith(
    expect.objectContaining({
      ai: expect.objectContaining({
        provider: "ollama",
        baseUrl: "http://localhost:11434/v1",
        model: "llama3.2",
        enabled: true,
      }),
    }),
  );
});

test("saves config with custom base URL when Custom provider selected", async () => {
  const ui = createUIMock({
    askSelect: mock()
      .mockResolvedValueOnce("ai")
      .mockResolvedValueOnce("configure")
      .mockResolvedValueOnce("custom"),
    askText: mock()
      .mockResolvedValueOnce("https://my-llm.example.com/v1")
      .mockResolvedValueOnce("my-model")
      .mockResolvedValueOnce("my-api-key"),
    askConfirm: mock(() => Promise.resolve(true)),
  });

  await new Settings(ui).run();

  expect(MOCK_WRITE).toHaveBeenCalledWith(
    expect.objectContaining({
      ai: expect.objectContaining({
        provider: "custom",
        baseUrl: "https://my-llm.example.com/v1",
        model: "my-model",
        apiKey: "my-api-key",
        enabled: true,
      }),
    }),
  );
});

// ─── toggle ───────────────────────────────────────────────────────────────────

test("disables AI when user chooses disable", async () => {
  MOCK_READ.mockResolvedValueOnce({
    ai: { enabled: true, baseUrl: "https://x.com", apiKey: "k", model: "m" },
  });

  const ui = createUIMock({
    askSelect: mock().mockResolvedValueOnce("ai").mockResolvedValueOnce("disable"),
  });

  await new Settings(ui).run();

  expect(MOCK_WRITE).toHaveBeenCalledWith(
    expect.objectContaining({ ai: expect.objectContaining({ enabled: false }) }),
  );
});

test("enables AI when user chooses enable", async () => {
  MOCK_READ.mockResolvedValueOnce({
    ai: { enabled: false, baseUrl: "https://x.com", apiKey: "k", model: "m" },
  });

  const ui = createUIMock({
    askSelect: mock().mockResolvedValueOnce("ai").mockResolvedValueOnce("enable"),
  });

  await new Settings(ui).run();

  expect(MOCK_WRITE).toHaveBeenCalledWith(
    expect.objectContaining({ ai: expect.objectContaining({ enabled: true }) }),
  );
});

test("shows Enable option when AI is configured but disabled", async () => {
  MOCK_READ.mockResolvedValueOnce({
    ai: { enabled: false, baseUrl: "https://x.com", apiKey: "k", model: "m" },
  });

  const ui = createUIMock({
    askSelect: mock()
      .mockResolvedValueOnce("ai")
      .mockImplementationOnce((_: string, options: { value: string }[]) => {
        const values = options.map((o) => o.value);
        expect(values).toContain("enable");
        expect(values).not.toContain("disable");
        return Promise.resolve("enable");
      }),
  });

  await new Settings(ui).run();
});

test("shows Disable option when AI is enabled", async () => {
  MOCK_READ.mockResolvedValueOnce({
    ai: { enabled: true, baseUrl: "https://x.com", apiKey: "k", model: "m" },
  });

  const ui = createUIMock({
    askSelect: mock()
      .mockResolvedValueOnce("ai")
      .mockImplementationOnce((_: string, options: { value: string }[]) => {
        const values = options.map((o) => o.value);
        expect(values).toContain("disable");
        expect(values).not.toContain("enable");
        return Promise.resolve("disable");
      }),
  });

  await new Settings(ui).run();
});

test("shows only Configure option when no config exists yet", async () => {
  MOCK_READ.mockResolvedValueOnce({});

  const ui = createUIMock({
    askSelect: mock()
      .mockResolvedValueOnce("ai")
      .mockImplementationOnce((_: string, options: { value: string }[]) => {
        expect(options.map((o) => o.value)).toEqual(["configure"]);
        return Promise.resolve("configure");
      })
      .mockResolvedValueOnce("openai"),
    askText: mock().mockResolvedValueOnce("gpt-4o").mockResolvedValueOnce("sk-key"),
    askConfirm: mock(() => Promise.resolve(false)),
  });

  await new Settings(ui).run();
});

// ─── connection test ──────────────────────────────────────────────────────────

test("runs connection test and shows success when user opts in", async () => {
  MOCK_TEST_CONNECTION.mockClear();
  MOCK_TEST_CONNECTION.mockResolvedValueOnce(undefined);
  const ui = createUIMock({
    askSelect: mock()
      .mockResolvedValueOnce("ai")
      .mockResolvedValueOnce("configure")
      .mockResolvedValueOnce("openai"),
    askText: mock().mockResolvedValueOnce("gpt-4o").mockResolvedValueOnce("sk-key"),
    askConfirm: mock(() => Promise.resolve(true)),
  });

  await new Settings(ui).run();

  expect(MOCK_TEST_CONNECTION).toHaveBeenCalledTimes(1);
  expect(ui.success).toHaveBeenCalledWith("Connection successful!");
});

test("shows warning when connection test fails", async () => {
  MOCK_TEST_CONNECTION.mockClear();
  MOCK_TEST_CONNECTION.mockRejectedValueOnce(
    new Error("Invalid API key — check your credentials in Settings"),
  );
  const ui = createUIMock({
    askSelect: mock()
      .mockResolvedValueOnce("ai")
      .mockResolvedValueOnce("configure")
      .mockResolvedValueOnce("openai"),
    askText: mock().mockResolvedValueOnce("gpt-4o").mockResolvedValueOnce("bad-key"),
    askConfirm: mock(() => Promise.resolve(true)),
  });

  await new Settings(ui).run();

  expect(ui.warn).toHaveBeenCalledWith(expect.stringContaining("Invalid API key"));
  expect(ui.info).toHaveBeenCalledWith(expect.stringContaining("may not work"));
});

test("skips connection test when user declines", async () => {
  MOCK_TEST_CONNECTION.mockClear();
  const ui = createUIMock({
    askSelect: mock()
      .mockResolvedValueOnce("ai")
      .mockResolvedValueOnce("configure")
      .mockResolvedValueOnce("openai"),
    askText: mock().mockResolvedValueOnce("gpt-4o").mockResolvedValueOnce("sk-key"),
    askConfirm: mock().mockResolvedValueOnce(true).mockResolvedValueOnce(false),
  });

  await new Settings(ui).run();

  expect(MOCK_TEST_CONNECTION).not.toHaveBeenCalled();
});

// ─── limits ───────────────────────────────────────────────────────────────────

test("saves updated limits when user enters valid values", async () => {
  MOCK_WRITE.mockClear();
  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("limits")),
    askText: mock()
      .mockResolvedValueOnce("20") // undo limit
      .mockResolvedValueOnce("50") // cherry-pick limit
      .mockResolvedValueOnce("40") // bisect limit
      .mockResolvedValueOnce("25"), // revert limit
  });

  await new Settings(ui).run();

  expect(MOCK_WRITE).toHaveBeenCalledWith(
    expect.objectContaining({
      limits: {
        undoCommitLimit: 20,
        cherryPickLogLimit: 50,
        bisectLogLimit: 40,
        revertLogLimit: 25,
      },
    }),
  );
  expect(ui.success).toHaveBeenCalledWith(expect.stringContaining("20"));
});

test("keeps current value when user enters invalid input for a limit", async () => {
  MOCK_WRITE.mockClear();
  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("limits")),
    askText: mock()
      .mockResolvedValueOnce("abc") // invalid → keeps default 10
      .mockResolvedValueOnce("30")
      .mockResolvedValueOnce("30"),
  });

  await new Settings(ui).run();

  expect(MOCK_WRITE).toHaveBeenCalledWith(
    expect.objectContaining({
      limits: expect.objectContaining({ undoCommitLimit: 10 }),
    }),
  );
});

test("rejects values above 500 and keeps current limit", async () => {
  MOCK_WRITE.mockClear();
  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("limits")),
    askText: mock()
      .mockResolvedValueOnce("999") // > 500 → keeps default 10
      .mockResolvedValueOnce("30")
      .mockResolvedValueOnce("30"),
  });

  await new Settings(ui).run();

  expect(MOCK_WRITE).toHaveBeenCalledWith(
    expect.objectContaining({
      limits: expect.objectContaining({ undoCommitLimit: 10 }),
    }),
  );
});
