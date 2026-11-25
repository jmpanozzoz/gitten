export interface PushUpdate {
  localRef: string;
  oid: string;
  remoteOid: string;
}

const supportedOid = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

export function parsePushUpdates(input: string): PushUpdate[] {
  const updates: PushUpdate[] = [];
  for (const line of input.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const update = parseLine(line);
    const isDeletion = /^0+$/.test(update.oid);
    if (isDeletion !== (update.localRef === "(delete)")) {
      throw new Error("Inconsistent ref deletion received from Git pre-push.");
    }
    if (!isDeletion) updates.push(update);
  }
  return updates;
}

function parseLine(line: string): PushUpdate {
  const fields = line.split(" ");
  const [localRef, oid, remoteRef, remoteOid] = fields;
  if (!localRef || !oid || !remoteRef || !remoteOid || fields.length !== 4) invalidUpdate();
  if (!supportedOid.test(oid) || !supportedOid.test(remoteOid) || oid.length !== remoteOid.length) {
    invalidUpdate();
  }
  return { localRef, oid, remoteOid };
}

function invalidUpdate(): never {
  throw new Error("Invalid ref update received from Git pre-push.");
}
