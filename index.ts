import { app } from "./src/app";

process.on("uncaughtException", (err) => {
  console.error("Unexpected error:", err.message);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
  process.exit(1);
});

app();
