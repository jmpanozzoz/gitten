const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function normalizeAIBaseUrl(value: string): string | null {
  const url = URL.parse(value.trim());
  if (!url || url.username || url.password || url.search || url.hash) return null;
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname))
  ) {
    return null;
  }

  return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
}
