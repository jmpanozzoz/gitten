export interface RemoteResetTarget {
  branch: string;
  head: string;
  remote: string;
  ref: string;
  commit: string;
}

export function sameResetSource(expected: RemoteResetTarget, actual: RemoteResetTarget): boolean {
  return (
    expected.branch === actual.branch &&
    expected.head === actual.head &&
    expected.remote === actual.remote &&
    expected.ref === actual.ref
  );
}

export function sameResetTarget(
  expected: RemoteResetTarget,
  actual: RemoteResetTarget | null,
): boolean {
  return actual !== null && sameResetSource(expected, actual) && expected.commit === actual.commit;
}
