import { test, expect, mock } from "bun:test";
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
}));

mock.module("../../src/core/ai-suggester", () => ({
  testAIConnection: MOCK_TEST_CONNECTION,
}));

// ─── configure ────────────────────────────────────────────────────────────────

test("saves full config when user fills in all fields (openai provider)", async () => {
  const ui = createUIMock({
    askSelect: mock()
      .mockResolvedValueOnce("configure")   // action menu
      .mockResolvedValueOnce("openai"),      // provider
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
    })
  );
});

test("saves config without API key for Ollama (local, no key required)", async () => {
  const ui = createUIMock({
    askSelect: mock()
      .mockResolvedValueOnce("configure")
      .mockResolvedValueOnce("ollama"),
    askText: mock().mockResolvedValueOnce("llama3.2"), // model only
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
    })
  );
});

test("saves config with custom base URL when Custom provider selected", async () => {
  const ui = createUIMock({
    askSelect: mock()
      .mockResolvedValueOnce("configure")
      .mockResolvedValueOnce("custom"),
    askText: mock()
      .mockResolvedValueOnce("https://my-llm.example.com/v1") // base URL (custom)
      .mockResolvedValueOnce("my-model")                       // model
      .mockResolvedValueOnce("my-api-key"),                    // api key
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
    })
  );
});

// ─── toggle ───────────────────────────────────────────────────────────────────

test("disables AI when user chooses disable", async () => {
  MOCK_READ.mockResolvedValueOnce({
    ai: { enabled: true, baseUrl: "https://x.com", apiKey: "k", model: "m" },
  });

  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("disable")),
  });

  await new Settings(ui).run();

  expect(MOCK_WRITE).toHaveBeenCalledWith(
    expect.objectContaining({ ai: expect.objectContaining({ enabled: false }) })
  );
});

test("enables AI when user chooses enable", async () => {
  MOCK_READ.mockResolvedValueOnce({
    ai: { enabled: false, baseUrl: "https://x.com", apiKey: "k", model: "m" },
  });

  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("enable")),
  });

  await new Settings(ui).run();

  expect(MOCK_WRITE).toHaveBeenCalledWith(
    expect.objectContaining({ ai: expect.objectContaining({ enabled: true }) })
  );
});

test("shows Enable option when AI is configured but disabled", async () => {
  MOCK_READ.mockResolvedValueOnce({
    ai: { enabled: false, baseUrl: "https://x.com", apiKey: "k", model: "m" },
  });

  const ui = createUIMock({
    askSelect: mock((_, options) => {
      const values = options.map((o: { value: string }) => o.value);
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
    askSelect: mock((_, options) => {
      const values = options.map((o: { value: string }) => o.value);
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
      .mockImplementationOnce((_: string, options: { value: string }[]) => {
        expect(options.map((o) => o.value)).toEqual(["configure"]);
        return Promise.resolve("configure");
      })
      .mockResolvedValueOnce("openai"), // provider
    askText: mock()
      .mockResolvedValueOnce("gpt-4o")  // model
      .mockResolvedValueOnce("sk-key"), // api key
    askConfirm: mock(() => Promise.resolve(false)),
  });

  await new Settings(ui).run();
});

// ─── connection test ──────────────────────────────────────────────────────────

test("runs connection test and shows success when user opts in", async () => {
  MOCK_TEST_CONNECTION.mockClear();
  MOCK_TEST_CONNECTION.mockResolvedValueOnce(undefined);
  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("configure")),
    askText: mock()
      .mockResolvedValueOnce("https://api.openai.com/v1")
      .mockResolvedValueOnce("sk-key")
      .mockResolvedValueOnce("gpt-4o"),
    askConfirm: mock(() => Promise.resolve(true)),
  });

  await new Settings(ui).run();

  expect(MOCK_TEST_CONNECTION).toHaveBeenCalledTimes(1);
  expect(ui.success).toHaveBeenCalledWith("Connection successful!");
});

test("shows warning when connection test fails", async () => {
  MOCK_TEST_CONNECTION.mockRejectedValueOnce(new Error("Invalid API key — check your credentials in Settings"));
  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("configure")),
    askText: mock()
      .mockResolvedValueOnce("https://api.openai.com/v1")
      .mockResolvedValueOnce("bad-key")
      .mockResolvedValueOnce("gpt-4o"),
    askConfirm: mock(() => Promise.resolve(true)),
  });

  await new Settings(ui).run();

  expect(ui.warn).toHaveBeenCalledWith(expect.stringContaining("Invalid API key"));
  expect(ui.info).toHaveBeenCalledWith(expect.stringContaining("may not work"));
});

test("skips connection test when user declines", async () => {
  MOCK_TEST_CONNECTION.mockClear();
  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("configure")),
    askText: mock()
      .mockResolvedValueOnce("https://api.openai.com/v1")
      .mockResolvedValueOnce("sk-key")
      .mockResolvedValueOnce("gpt-4o"),
    // First confirm = enable (true), second = test connection (false)
    askConfirm: mock()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false),
  });

  await new Settings(ui).run();

  expect(MOCK_TEST_CONNECTION).not.toHaveBeenCalled();
});

// ─── cancellation ─────────────────────────────────────────────────────────────

test("propagates GoBackSignal when user presses ESC", async () => {
  MOCK_WRITE.mockClear();
  const ui = createUIMock({
    askSelect: mock(() => Promise.reject(new GoBackSignal())),
  });

  await expect(new Settings(ui).run()).rejects.toBeInstanceOf(GoBackSignal);
  expect(MOCK_WRITE).not.toHaveBeenCalled();
});
