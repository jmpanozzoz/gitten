export interface PullTarget {
  branch: string;
  head: string | null;
  remote: string;
  refs: readonly string[];
  url: string;
}

export class PullTargetChanged extends Error {
  constructor() {
    super("The branch, upstream, or Git operation changed. Review Pull again.");
  }
}
