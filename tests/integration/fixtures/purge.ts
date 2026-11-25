import { createGitClient } from "../../../src/git/git-client";

const client = createGitClient();
const paths = process.argv.slice(2);

if (!(await client.filterRepoAvailable())) throw new Error("Filter tool unavailable.");
const scope = await client.describePurge(paths);
console.log("COPY", await client.purgeFromHistory(paths, scope.refs));
