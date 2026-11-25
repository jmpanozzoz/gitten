import { version } from "./package.json";
import { app } from "./src/app";
import { runCli } from "./src/composition/cli";
import { gitPrerequisiteIssue } from "./src/git/git-version";

process.exit(
  await runCli({
    args: process.argv.slice(2),
    version,
    interactive: process.stdin.isTTY === true && process.stdout.isTTY === true,
    gitPrerequisiteIssue,
    start: app,
    stdout: (message) => console.log(message),
    stderr: (message) => console.error(message),
  }),
);
