const minimum = [2, 43, 7];
const required = `Install Git ${minimum.join(".")} or later and make sure it is on PATH.`;
const unreadable = `Could not read the Git version. ${required}`;

export function gitPrerequisiteIssue(): string | undefined {
  const executable = Bun.which("git");
  if (!executable) return `Git executable not found. ${required}`;
  try {
    const result = Bun.spawnSync([executable, "--version"], {
      stderr: "ignore",
      timeout: 2500,
      maxBuffer: 4096,
    });
    if (!result.success) return unreadable;
    return checkVersion(result.stdout.toString());
  } catch {
    return unreadable;
  }
}

function checkVersion(output: string): string | undefined {
  const match = /^git version (\d+\.\d+\.\d+)([.-]rc\d+)?(?:[. \t-][^\r\n]*)?$/.exec(output.trim());
  if (!match) return unreadable;
  const components = match[1]!.split(".").map(Number);
  for (const [position, limit] of minimum.entries()) {
    const component = components[position]!;
    if (component > limit) return;
    if (component < limit) return `Git ${match[1]} is too old. ${required}`;
  }
  if (match[2]) return `Git ${match[1]}${match[2]} is too old. ${required}`;
}
