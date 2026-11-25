export function fetchSource(trackingRef: string, specifications: readonly string[]): string | null {
  const exclusions = specifications.filter((spec) => spec.startsWith("^"));
  const candidates = new Set(
    specifications.flatMap((spec) => {
      const [src, dest] = spec.replace(/^\+/, "").split(":");
      if (!src || !dest || src.startsWith("^")) return [];
      const match = captureWildcard(dest, trackingRef);
      if (match === null) return [];
      const ref = src.replace("*", () => match);
      return exclusions.some((pattern) => captureWildcard(pattern.slice(1), ref) !== null)
        ? []
        : [ref];
    }),
  );
  return candidates.size === 1 ? [...candidates][0]! : null;
}

function captureWildcard(spec: string, ref: string): string | null {
  const star = spec.indexOf("*");
  if (star < 0) return spec === ref ? "" : null;
  const prefix = spec.slice(0, star);
  const suffix = spec.slice(star + 1);
  if (
    !ref.startsWith(prefix) ||
    !ref.endsWith(suffix) ||
    ref.length < prefix.length + suffix.length
  ) {
    return null;
  }
  return ref.slice(prefix.length, ref.length - suffix.length);
}
