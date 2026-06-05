import { version } from "./package.json";
import { app } from "./src/app";

if (process.argv.includes("--version") || process.argv.includes("-v")) {
  console.log(`gitten v${version}`);
  process.exit(0);
}

process.on("uncaughtException", (err) => {
  console.error("Unexpected error:", err.message);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
  process.exit(1);
});

app()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Unexpected error:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
