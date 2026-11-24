import type {
  Constraint,
  Finding,
  FindingCode,
  Handoff,
  Manifest,
  VerificationResult,
} from "./contracts.js";
import { identifier, timestamp } from "./validation.js";

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
  const time = timestamp(asOf, "asOf");
  const byId = new Map(manifest.constraints.map((rule) => [rule.id, rule]));
  const expectedConstraints = manifest.constraints
    .filter((rule) => inactive(rule, scope, time) === undefined)
    .map((rule) => rule.id)
    .sort(compare);
  const reportedConstraints = [...handoff.activeConstraints].sort(compare);
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
    }
  }
  findings.sort((a, b) => compare(a.id, b.id) || compare(a.code, b.code));
  return {
    schemaVersion: 1,
    status: findings.length ? "mismatch" : "verified",
    scope,
    asOf: new Date(time).toISOString(),
    expectedConstraints,
    reportedConstraints,
    findings,
  };
}
