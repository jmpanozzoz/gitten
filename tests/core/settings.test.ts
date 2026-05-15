import { test, expect, mock } from "bun:test";
import { Settings } from "../../src/core/settings";
import { createUIMock } from "../mocks/ui.mock";

const MOCK_READ = mock(() => Promise.resolve({}));
const MOCK_WRITE = mock(() => Promise.resolve());

mock.module("../../src/config/config", () => ({
  readConfig: MOCK_READ,
  writeConfig: MOCK_WRITE,
  getActiveAIConfig: mock(() => Promise.resolve(null)),
}));

// ─── enable / disable ─────────────────────────────────────────────────────────

test("saves full config when user fills in all fields", async () => {
  const ui = createUIMock({
    askSelect: mock()
      .mockResolvedValueOnce("configure")
      .mockResolvedValueOnce("back"),
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

test("disables AI when user chooses disable", async () => {
  MOCK_READ.mockResolvedValueOnce({
    ai: { enabled: true, baseUrl: "https://x.com", apiKey: "k", model: "m" },
  });

  const ui = createUIMock({
    askSelect: mock()
      .mockResolvedValueOnce("disable")
      .mockResolvedValueOnce("back"),
  });

  await new Settings(ui).run();

  expect(MOCK_WRITE).toHaveBeenCalledWith(
    expect.objectContaining({ ai: expect.objectContaining({ enabled: false }) })
  );
});

test("does nothing when user selects back immediately", async () => {
  MOCK_WRITE.mockClear();
  const ui = createUIMock({
    askSelect: mock(() => Promise.resolve("back")),
  });

  await new Settings(ui).run();

  expect(MOCK_WRITE).not.toHaveBeenCalled();
});
