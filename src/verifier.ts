import { reference } from "./content.js";
import type {
  Constraint,
  ContentHandoff,
  Finding,
  FindingCode,
  Handoff,
  Manifest,
  VerificationResult,
} from "./contracts.js";
import { InputError, identifier, timestamp } from "./validation.js";

// Locale-independent ordering keeps results stable across machines.
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function inactive(
  rule: Constraint,
  scope: string,
  time: number,
): FindingCode | undefined {
  if (rule.scope !== "global" && rule.scope !== scope) return "OUT_OF_SCOPE";
  if (rule.revokedAt !== undefined && time >= Date.parse(rule.revokedAt))
    return "REVOKED";
  if (rule.supersededAt !== undefined && time >= Date.parse(rule.supersededAt))
    return "SUPERSEDED";
  if (rule.expiresAt !== undefined && time >= Date.parse(rule.expiresAt))
    return "EXPIRED";
  return undefined;
}

/** Inputs must be validated with parseManifest and parseHandoff first. */
export function verify(
  manifest: Manifest,
  handoff: Handoff,
  scope: string,
  asOf: string,
): VerificationResult {
  identifier(scope, "scope");
  if (handoff.schemaVersion === 2 && handoff.scope !== scope)
    throw new InputError(
      `Handoff scope '${handoff.scope}' does not match selected scope '${scope}'`,
    );
  const time = timestamp(asOf, "asOf");
  const byId = new Map(manifest.constraints.map((rule) => [rule.id, rule]));
  const expectedConstraints = manifest.constraints
    .filter((rule) => inactive(rule, scope, time) === undefined)
    .map((rule) => rule.id)
    .sort(compare);
  const refs = new Map(
    handoff.schemaVersion === 2
      ? handoff.activeConstraints.map((ref) => [ref.id, ref])
      : [],
  );
  const reportedConstraints = (
    handoff.schemaVersion === 1
      ? [...handoff.activeConstraints]
      : handoff.activeConstraints.map((ref) => ref.id)
  ).sort(compare);
  const reported = new Set(reportedConstraints);
  const findings: Finding[] = [];
  for (const id of expectedConstraints) {
    if (!reported.has(id))
      findings.push({
        code: "MISSING",
        id,
        message: `Include active constraint: ${byId.get(id)?.description}`,
      });
  }
  for (const id of reportedConstraints) {
    const rule = byId.get(id);
    const code = rule ? inactive(rule, scope, time) : "UNKNOWN";
    if (code) {
      const detail =
        code === "SUPERSEDED" ? `; replaced by '${rule?.replacedBy}'` : "";
      findings.push({
        code,
        id,
        message: `Remove ${code.toLowerCase().replaceAll("_", "-")} constraint${detail}${rule ? `: ${rule.description}` : ""}`,
      });
    } else if (rule && handoff.schemaVersion === 2) {
      const current = reference(rule);
      const previous = refs.get(id);
      if (
        previous &&
        (current.revision !== previous.revision ||
          current.contentHash !== previous.contentHash)
      ) {
        findings.push({
          code: "CHANGED",
          id,
          message: `Review changed constraint: ${rule.description}; handoff revision ${previous.revision}, current revision ${current.revision}${current.contentHash !== previous.contentHash ? "; content hash differs" : ""}`,
          expected: {
            revision: current.revision,
            contentHash: current.contentHash,
          },
          reported: {
            revision: previous.revision,
            contentHash: previous.contentHash,
          },
        });
      }
    }
  }
  findings.sort((a, b) => compare(a.id, b.id) || compare(a.code, b.code));
  return {
    schemaVersion: handoff.schemaVersion,
    ...(handoff.schemaVersion === 2 ? { tracking: "content" as const } : {}),
    status: findings.length ? "mismatch" : "verified",
    scope,
    asOf: new Date(time).toISOString(),
    expectedConstraints,
    reportedConstraints,
    findings,
  };
}

/** Capture only after reviewing the current rules; never auto-refresh at resume. */
export function snapshot(
  manifest: Manifest,
  task: string,
  scope: string,
  asOf: string,
): ContentHandoff {
  if (!task.trim()) throw new InputError("--task: expected a non-empty task");
  const result = verify(
    manifest,
    { schemaVersion: 1, task, activeConstraints: [] },
    scope,
    asOf,
  );
  const byId = new Map(manifest.constraints.map((rule) => [rule.id, rule]));
  return {
    schemaVersion: 2,
    task,
    scope,
    capturedAt: result.asOf,
    activeConstraints: result.expectedConstraints.map((id) =>
      reference(byId.get(id) as Constraint),
    ),
  };
}
