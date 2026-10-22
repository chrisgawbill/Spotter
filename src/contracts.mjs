/** Observed JSON structure, independent of values, object order and array length. */
export function responseShape(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    const items = [...new Set(value.map((item) => JSON.stringify(responseShape(item))))].sort();
    return { array: items.map((item) => JSON.parse(item)) };
  }
  if (typeof value === 'object') {
    return { object: Object.fromEntries(Object.keys(value).sort().map((key) => [key, responseShape(value[key])])) };
  }
  return typeof value;
}

/** Snapshot each recorded response, keeping signed-in sessions separate. */
export function snapshotContracts(fixtures) {
  const sessions = { anonymous: fixtures?.entries ?? {}, ...fixtures?.sessions };
  return Object.fromEntries(Object.keys(sessions).sort().map((session) => [session,
    Object.fromEntries(Object.keys(sessions[session]).sort().map((request) => {
      const response = sessions[session][request];
      const contentType = (response.contentType ?? 'application/octet-stream').split(';')[0].trim().toLowerCase();
      let shape;
      try {
        const body = response.encoding === 'base64' ? Buffer.from(response.body, 'base64').toString('utf8') : response.body;
        shape = responseShape(JSON.parse(body));
      } catch {
        shape = { contentType };
      }
      return [request, { status: response.status, contentType, shape }];
    }))]));
}

/** First recording establishes the baseline; later recordings report observed drift. */
export function compareContracts(previousFixtures, nextFixtures) {
  if (!previousFixtures) return [];
  const before = snapshotContracts(previousFixtures);
  const after = snapshotContracts(nextFixtures);
  const changes = [];
  for (const session of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
    for (const request of [...new Set([...Object.keys(before[session] ?? {}), ...Object.keys(after[session] ?? {})])].sort()) {
      const oldResponse = before[session]?.[request];
      const newResponse = after[session]?.[request];
      if (JSON.stringify(oldResponse) === JSON.stringify(newResponse)) continue;
      changes.push({ session, request, kind: !oldResponse ? 'added' : !newResponse ? 'removed' : 'changed',
        ...(oldResponse ? { before: oldResponse } : {}), ...(newResponse ? { after: newResponse } : {}) });
    }
  }
  return changes;
}
