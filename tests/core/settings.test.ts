import { test, expect, mock } from "bun:test";
import { Settings } from "../../src/core/settings";
import { GoBackSignal } from "../../src/ui/go-back";
import { createUIMock } from "../mocks/ui.mock";

const MOCK_READ = mock(() => Promise.resolve({}));
const MOCK_WRITE = mock(() => Promise.resolve());

mock.module("../../src/config/config", () => ({
  readConfig: MOCK_READ,
  writeConfig: MOCK_WRITE,
  getActiveAIConfig: mock(() => Promise.resolve(null)),
}));

// ─── configure ────────────────────────────────────────────────────────────────

test("saves full config when user fills in all fields", async () => {
  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("configure")),
    askText: mock()
      .mockResolvedValueOnce("https://api.openai.com/v1")
      .mockResolvedValueOnce("sk-test-key")
      .mockResolvedValueOnce("gpt-4o-mini"),
    askConfirm: mock(() => Promise.resolve(true)),
  });

  await new Settings(ui).run();

  expect(MOCK_WRITE).toHaveBeenCalledWith(
    expect.objectContaining({
      ai: expect.objectContaining({
        baseUrl: "https://api.openai.com/v1",
        apiKey: "sk-test-key",
        model: "gpt-4o-mini",
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
    askSelect: mock((_, options) => {
      const values = options.map((o: { value: string }) => o.value);
      expect(values).toEqual(["configure"]);
      return Promise.resolve("configure");
    }),
    askText: mock()
      .mockResolvedValueOnce("https://api.openai.com/v1")
      .mockResolvedValueOnce("sk-key")
      .mockResolvedValueOnce("gpt-4o"),
    askConfirm: mock(() => Promise.resolve(false)),
  });

  await new Settings(ui).run();
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
