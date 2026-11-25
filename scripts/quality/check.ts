import { rm } from "node:fs/promises";
import { join } from "node:path";

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== "--report")) {
    console.error("Usage: bun run quality:check [--report]");
    process.exitCode = 1;
  } else {
    const reports = join(process.cwd(), "coverage");
    await Promise.all(
      ["tests.xml", "quality.json"].map((file) => rm(join(reports, file), { force: true })),
    );
    for (const command of ["quality:static", "quality:coverage"]) {
      const options = command === "quality:coverage" ? args : [];
      const result = Bun.spawn([process.execPath, "--no-env-file", "run", command, ...options], {
        stdout: "inherit",
        stderr: "inherit",
      });
      const code = await result.exited;
      if (code !== 0) {
        process.exitCode = code;
        break;
      }
    }
  }
}
