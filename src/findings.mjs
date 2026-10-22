import { createHash } from 'node:crypto';

/** Severity order, most severe first. `high` and `medium` fail a run. */
export const SEVERITIES = ['high', 'medium', 'low'];
const FAILING_SEVERITIES = new Set(['high', 'medium']);

/**
 * Builds a finding. `key` holds the fields that identify the problem across
 * runs (no line numbers, hashes or pixel counts) and feeds the fingerprint;
 * everything else is presentation.
 */
export function createFinding({
  stage,
  check,
  severity,
  title,
  file = null,
  line = null,
  where = null,
  detail = null,
  repro = null,
  artifacts = [],
  key = {},
}) {
  const identity = {
    stage,
    check,
    file,
    title: normalizeForFingerprint(title),
    ...key,
  };
  return {
    id: fingerprintOf(identity),
    stage,
    check,
    severity,
    title,
    file,
    line,
    where,
    detail,
    repro,
    artifacts,
  };
}

/** Lowercases and masks numbers and hashes so cosmetic drift keeps the same fingerprint. */
export function normalizeForFingerprint(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/\b[0-9a-f]{7,40}\b/g, '<hash>')
    .replace(/\d+(\.\d+)?/g, '#')
    .replace(/\s+/g, ' ')
    .trim();
}

function fingerprintOf(identity) {
  const stable = JSON.stringify(identity, Object.keys(identity).sort());
  return createHash('sha1').update(stable).digest('hex').slice(0, 12);
}

/** Splits head findings into new / existing against the base run, and lists base findings the head fixed. */
export function compareWithBaseline(headFindings, baseFindings) {
  const baseIds = new Set(baseFindings.map((finding) => finding.id));
  const headIds = new Set(headFindings.map((finding) => finding.id));
  return {
    newFindings: headFindings.filter((finding) => !baseIds.has(finding.id)),
    existingFindings: headFindings.filter((finding) => baseIds.has(finding.id)),
    fixedFindings: baseFindings.filter((finding) => !headIds.has(finding.id)),
  };
}

/** True when any finding is severe enough to fail the run. */
export function hasFailingFinding(findings) {
  return findings.some((finding) => FAILING_SEVERITIES.has(finding.severity));
}

/** Sorts by severity, then stage order, then title, so reports read most-severe first. */
export function sortFindings(findings, stageOrder = []) {
  const stageRank = (stage) => {
    const rank = stageOrder.indexOf(stage);
    return rank === -1 ? stageOrder.length : rank;
  };
  return [...findings].sort(
    (left, right) =>
      SEVERITIES.indexOf(left.severity) - SEVERITIES.indexOf(right.severity) ||
      stageRank(left.stage) - stageRank(right.stage) ||
      left.title.localeCompare(right.title),
  );
}

/** Removes exact duplicate findings (same fingerprint), keeping the first. */
export function dedupeFindings(findings) {
  const seen = new Set();
  return findings.filter((finding) => {
    if (seen.has(finding.id)) return false;
    seen.add(finding.id);
    return true;
  });
}
