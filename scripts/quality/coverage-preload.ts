import { afterAll } from "bun:test";
import { loadCoverageSession, writeCounters } from "./coverage-session";

const directory = loadCoverageSession(process.env.GITTEN_COVERAGE_SESSION);
afterAll(() => writeCounters(directory, "counters.json", Reflect.get(globalThis, "__coverage__")));
