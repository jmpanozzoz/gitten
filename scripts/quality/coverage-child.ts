import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadCoverageSession, writeCounters } from "./coverage-session";

const directory = loadCoverageSession(process.env.GITTEN_COVERAGE_SESSION);
const artifact = `child-${process.pid}`;
writeFileSync(join(directory, `${artifact}.started`), "");
process.once("exit", () =>
  writeCounters(directory, `${artifact}.json`, Reflect.get(globalThis, "__coverage__")),
);
