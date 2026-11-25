import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkForUpdate } from "../../src/utils/update-checker";
import { runBun } from "../support/run-bun";

let directory: string;
let cachePath: string;
const now = 200_000_000;
const request = mock<(url: string, init: RequestInit) => Promise<Response>>();

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "gitten-update-test-"));
  cachePath = join(directory, "update-check.json");
  request.mockReset();
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

const check = (current = "1.3.0") =>
  checkForUpdate(current, { cachePath, now: () => now, request });

function cache(latestVersion: string, checkedAt = now): void {
  writeFileSync(cachePath, JSON.stringify({ latestVersion, checkedAt }));
}

test("compares real cached releases numerically without contacting GitHub within the TTL", async () => {
  for (const version of ["2.0.0", "1.10.0", "1.3.1"]) {
    cache(version);
    expect(await check()).toBe(version);
  }
  for (const version of ["1.3.0", "1.2.9", "0.99.0"]) {
    cache(version);
    expect(await check()).toBeNull();
  }
  expect(await check("unknown")).toBeNull();
  expect(request).not.toHaveBeenCalled();
});

test("serves stale data immediately and writes the verified release when the request completes", async () => {
  cache("1.3.1", 0);
  const response = Promise.withResolvers<Response>();
  request.mockReturnValue(response.promise);
  expect(await check()).toBe("1.3.1");
  expect(request).toHaveBeenCalledWith(
    "https://api.github.com/repos/jmpanozzoz/gitten/releases/latest",
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
  response.resolve(Response.json({ tag_name: "v1.4.0" }));
  await Bun.sleep(10);
  expect(await Bun.file(cachePath).json()).toEqual({ checkedAt: now, latestVersion: "1.4.0" });
});

test("keeps the existing cache when the request fails or sends an invalid release", async () => {
  cache("1.3.1", now + 30);
  const invalid = [
    () => Promise.reject(new Error("offline")),
    () => Promise.resolve(new Response(null, { status: 503 })),
    () => Promise.resolve(new Response("{")),
    () => Promise.resolve(Response.json(null)),
    () => Promise.resolve(Response.json({ tag_name: "v1.4.0-preview" })),
  ];
  for (const reply of invalid) {
    request.mockImplementation(reply);
    expect(await check()).toBe("1.3.1");
    await Bun.sleep(0);
    expect(await Bun.file(cachePath).json()).toEqual({
      checkedAt: now + 30,
      latestVersion: "1.3.1",
    });
  }
});

test("ignores malformed cache content and tolerates an unwritable cache", async () => {
  writeFileSync(cachePath, JSON.stringify({ latestVersion: "1.4.0" }));
  request.mockResolvedValue(Response.json({ tag_name: "v1.4.0" }));
  expect(
    await checkForUpdate("1.3.0", { cachePath: directory, now: () => now, request }),
  ).toBeNull();
  await Bun.sleep(0);
  request.mockResolvedValue(new Response(null, { status: 404 }));
  expect(await check()).toBeNull();
});

test("reads the default update cache from the user's configuration directory", () => {
  const userCache = join(directory, ".config", "gitten");
  mkdirSync(userCache, { recursive: true });
  writeFileSync(
    join(userCache, "update-check.json"),
    JSON.stringify({ latestVersion: "2.0.0", checkedAt: Date.now() }),
  );
  const source = new URL("../../src/utils/update-checker.ts", import.meta.url).href;
  const result = runBun(
    [
      "-e",
      `import { checkForUpdate } from ${JSON.stringify(source)}; console.log(await checkForUpdate("1.3.0"));`,
    ],
    directory,
    { HOME: directory, USERPROFILE: directory, XDG_CONFIG_HOME: undefined },
  );
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString().trim()).toBe("2.0.0");
});
