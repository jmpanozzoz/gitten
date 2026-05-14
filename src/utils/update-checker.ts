import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const REPO = "jmpanozzoz/gitten";

interface UpdateCache {
  checkedAt: number;
  latestVersion: string;
}

function cacheDir(): string {
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "gitten");
}

function readCache(): UpdateCache | null {
  try {
    return JSON.parse(readFileSync(join(cacheDir(), "update-check.json"), "utf8")) as UpdateCache;
  } catch {
    return null;
  }
}

function writeCache(data: UpdateCache): void {
  try {
    mkdirSync(cacheDir(), { recursive: true });
    writeFileSync(join(cacheDir(), "update-check.json"), JSON.stringify(data), "utf8");
  } catch {
    // non-fatal
  }
}

async function fetchLatestVersion(): Promise<string | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { "User-Agent": "gitten-update-checker" },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { tag_name: string };
    return json.tag_name.replace(/^v/, "");
  } catch {
    return null;
  }
}

function isNewer(latest: string, current: string): boolean {
  const parse = (v: string) => v.split(".").map(Number) as [number, number, number];
  const [la, lb, lc] = parse(latest);
  const [ca, cb, cc] = parse(current);
  if (la !== ca) return la > ca;
  if (lb !== cb) return lb > cb;
  return lc > cc;
}

export async function checkForUpdate(currentVersion: string): Promise<string | null> {
  const cache = readCache();
  const now = Date.now();

  if (cache && now - cache.checkedAt < CACHE_TTL_MS) {
    return isNewer(cache.latestVersion, currentVersion) ? cache.latestVersion : null;
  }

  // Cache stale — revalidate in background so startup isn't delayed
  fetchLatestVersion().then((latest) => {
    if (latest) writeCache({ checkedAt: now, latestVersion: latest });
  });

  return cache && isNewer(cache.latestVersion, currentVersion) ? cache.latestVersion : null;
}
