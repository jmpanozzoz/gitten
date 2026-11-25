import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const releaseURL = "https://api.github.com/repos/jmpanozzoz/gitten/releases/latest";
const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

interface UpdateCache {
  checkedAt: number;
  latestVersion: string;
}

interface UpdateSources {
  cachePath: string;
  now: () => number;
  request: (url: string, init: RequestInit) => Promise<Response>;
}

function cachePath(): string {
  return join(
    process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
    "gitten",
    "update-check.json",
  );
}

function readCache(path: string): UpdateCache | null {
  try {
    const data = JSON.parse(readFileSync(path, "utf8")) as Partial<UpdateCache> | null;
    if (
      typeof data?.checkedAt === "number" &&
      Number.isSafeInteger(data.checkedAt) &&
      typeof data.latestVersion === "string" &&
      stableVersion.test(data.latestVersion)
    )
      return { checkedAt: data.checkedAt, latestVersion: data.latestVersion };
  } catch {
    return null;
  }
  return null;
}

function writeCache(path: string, data: UpdateCache): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(data), "utf8");
  } catch {
    // Update notifications are optional.
  }
}

async function fetchLatestVersion(request: UpdateSources["request"]): Promise<string | null> {
  try {
    const response = await request(releaseURL, {
      headers: { "User-Agent": "gitten-update-checker" },
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return null;
    const json = (await response.json()) as { tag_name?: unknown } | null;
    if (typeof json?.tag_name !== "string") return null;
    const version = json.tag_name.replace(/^v/, "");
    return stableVersion.test(version) ? version : null;
  } catch {
    return null;
  }
}

function isNewer(latest: string, current: string): boolean {
  if (!stableVersion.test(current)) return false;
  const left = latest.split(".").map(BigInt);
  const right = current.split(".").map(BigInt);
  for (const [index, part] of left.entries()) {
    const previous = right[index]!;
    if (part !== previous) return part > previous;
  }
  return false;
}

export async function checkForUpdate(
  currentVersion: string,
  sources: UpdateSources = { cachePath: cachePath(), now: Date.now, request: fetch },
): Promise<string | null> {
  const cache = readCache(sources.cachePath);
  const now = sources.now();
  if (!cache || cache.checkedAt > now || now - cache.checkedAt >= CACHE_TTL_MS) {
    void fetchLatestVersion(sources.request).then((latestVersion) => {
      if (latestVersion) writeCache(sources.cachePath, { checkedAt: now, latestVersion });
    });
  }
  return cache && isNewer(cache.latestVersion, currentVersion) ? cache.latestVersion : null;
}
