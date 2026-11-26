import { reference, retainedContent } from "./content.js";
import type {
  Constraint,
  ContentHandoff,
  Explanation,
  FieldChange,
  Finding,
  Handoff,
  Manifest,
  ProjectHashHandoff,
  ProjectRetainedHandoff,
  RetainedHandoff,
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
): "OUT_OF_SCOPE" | "REVOKED" | "SUPERSEDED" | "EXPIRED" | undefined {
  if (rule.scope !== "global" && rule.scope !== scope) return "OUT_OF_SCOPE";
  if (rule.revokedAt !== undefined && time >= Date.parse(rule.revokedAt))
    return "REVOKED";
  if (rule.supersededAt !== undefined && time >= Date.parse(rule.supersededAt))
    return "SUPERSEDED";
  if (rule.expiresAt !== undefined && time >= Date.parse(rule.expiresAt))
    return "EXPIRED";
  return undefined;
}

/** Explicit portable binding, never inferred from repository paths or Git. */
export function checkProject(
  manifest: Manifest,
  handoff?: Handoff,
  expectedProjectId?: string,
): string | undefined {
  if (expectedProjectId !== undefined)
    identifier(expectedProjectId, "projectId");
  const boundManifest = manifest.schemaVersion === 3;
  const boundHandoff = handoff?.schemaVersion === 4;
  if (boundManifest || boundHandoff || expectedProjectId !== undefined) {
    if (!boundManifest)
      throw new InputError(
        "Project binding requires a schemaVersion 3 manifest; migrate both inputs deliberately",
      );
    const projectId = identifier(manifest.projectId, "manifest.projectId");
    if (expectedProjectId !== undefined && expectedProjectId !== projectId)
      throw new InputError(
        `Manifest project '${projectId}' does not match configured project '${expectedProjectId}'`,
      );
    if (
      handoff !== undefined &&
      (!boundHandoff || handoff.projectId !== projectId)
    )
      throw new InputError(
        `Handoff must be schemaVersion 4 bound to project '${projectId}'; review the intended project's baseline`,
      );
    return projectId;
  }
  return undefined;
}

/** Inputs must be validated with parseManifest and parseHandoff first. */
export function verify(
  manifest: Manifest,
  handoff: Handoff,
  scope: string,
  asOf: string,
  options: { requireActive?: boolean; projectId?: string } = {},
): VerificationResult {
  identifier(scope, "scope");
  const projectId = checkProject(manifest, handoff, options.projectId);
  if (handoff.schemaVersion !== 1 && handoff.scope !== scope)
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
    handoff.schemaVersion !== 1
      ? handoff.activeConstraints.map((ref) => [ref.id, ref])
      : [],
  );
  const reportedConstraints = (
    handoff.schemaVersion === 1
      ? [...handoff.activeConstraints]
      : handoff.activeConstraints.map((ref) => ref.id)
  ).sort(compare);
  const reported = new Set(reportedConstraints);
  const retained = new Map(
    handoff.schemaVersion === 3 ||
      (handoff.schemaVersion === 4 && handoff.contentMode === "retained")
      ? handoff.activeConstraints.map((ref) => [ref.id, ref.content])
      : [],
  );
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
    } else if (rule && handoff.schemaVersion !== 1) {
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
          ...(retained.has(id)
            ? {
                changes: fieldChanges(retained.get(id) as Constraint, rule),
              }
            : {}),
        });
      }
    }
  }
  if (options.requireActive && expectedConstraints.length === 0) {
    findings.push({
      code: "NO_ACTIVE_CONSTRAINTS",
      message:
        "No active constraints apply to the selected scope and time; --require-active requires at least one",
    });
  }
  findings.sort(
    (a, b) => compare(a.id ?? "", b.id ?? "") || compare(a.code, b.code),
  );
  return {
    schemaVersion: handoff.schemaVersion,
    ...(projectId === undefined ? {} : { projectId }),
    ...(handoff.schemaVersion !== 1
      ? {
          tracking: "content" as const,
          activeConstraintCount: expectedConstraints.length,
        }
      : {}),
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
  options?: { includeContent?: false; projectId?: string },
): ContentHandoff | ProjectHashHandoff;
export function snapshot(
  manifest: Manifest,
  task: string,
  scope: string,
  asOf: string,
  options: { includeContent: true; projectId?: string },
): RetainedHandoff | ProjectRetainedHandoff;
export function snapshot(
  manifest: Manifest,
  task: string,
  scope: string,
  asOf: string,
  options: { includeContent?: boolean; projectId?: string },
):
  | ContentHandoff
  | RetainedHandoff
  | ProjectHashHandoff
  | ProjectRetainedHandoff;
export function snapshot(
  manifest: Manifest,
  task: string,
  scope: string,
  asOf: string,
  options: { includeContent?: boolean; projectId?: string } = {},
):
  | ContentHandoff
  | RetainedHandoff
  | ProjectHashHandoff
  | ProjectRetainedHandoff {
  if (!task.trim()) throw new InputError("--task: expected a non-empty task");
  const projectId = checkProject(manifest, undefined, options.projectId);
  const result = explain(manifest, scope, asOf);
  const byId = new Map(manifest.constraints.map((rule) => [rule.id, rule]));
  const base = {
    task,
    scope,
    capturedAt: result.asOf,
  };
  const rules = result.rules
    .filter((rule) => rule.decision === "ACTIVE")
    .map((rule) => byId.get(rule.id) as Constraint);
  if (projectId !== undefined)
    return options.includeContent
      ? {
          ...base,
          schemaVersion: 4,
          projectId,
          contentMode: "retained",
          activeConstraints: rules.map((rule) => ({
            ...reference(rule),
            content: retainedContent(rule),
          })),
        }
      : {
          ...base,
          schemaVersion: 4,
          projectId,
          contentMode: "hashes",
          activeConstraints: rules.map(reference),
        };
  return options.includeContent
    ? {
        ...base,
        schemaVersion: 3,
        activeConstraints: rules.map((rule) => ({
          ...reference(rule),
          content: retainedContent(rule),
        })),
      }
    : { ...base, schemaVersion: 2, activeConstraints: rules.map(reference) };
}

const fields = [
  "id",
  "scope",
  "description",
  "source",
  "expiresAt",
  "revokedAt",
  "replacedBy",
  "supersededAt",
  "revision",
] as const;

export function fieldChanges(
  previous: Constraint,
  current: Constraint,
): FieldChange[] {
  const before = retainedContent(previous);
  const after = retainedContent(current);
  return fields
    .filter((field) => before[field] !== after[field])
    .map((field) => ({
      field,
      before: before[field] ?? null,
      after: after[field] ?? null,
    }));
}

/** Explains the supplied manifest at one instant; does not read a handoff. */
export function explain(
  manifest: Manifest,
  scope: string,
  asOf: string,
): Explanation {
  identifier(scope, "scope");
  const projectId = checkProject(manifest);
  const time = timestamp(asOf, "asOf");
  const rules = [...manifest.constraints]
    .sort((a, b) => compare(a.id, b.id))
    .map((rule) => {
      const decision: Explanation["rules"][number]["decision"] =
        inactive(rule, scope, time) ?? "ACTIVE";
      let reason: string;
      switch (decision) {
        case "ACTIVE":
          reason = `${rule.scope === "global" ? "Global rule" : "Selected scope matches"}; no lifecycle transition is effective`;
          break;
        case "OUT_OF_SCOPE":
          reason = `Rule scope '${rule.scope}' does not match '${scope}' and is not global`;
          break;
        case "REVOKED":
          reason = `Revoked at ${new Date(rule.revokedAt ?? "").toISOString()}`;
          break;
        case "SUPERSEDED":
          reason = `Superseded at ${new Date(rule.supersededAt ?? "").toISOString()}; replaced by '${rule.replacedBy}'`;
          break;
        case "EXPIRED":
          reason = `Expired at ${new Date(rule.expiresAt ?? "").toISOString()}`;
          break;
      }
      return {
        id: rule.id,
        scope: rule.scope,
        description: rule.description,
        source: rule.source,
        decision,
        reason,
      };
    });
  return {
    schemaVersion: 1,
    ...(projectId === undefined ? {} : { projectId }),
    scope,
    asOf: new Date(time).toISOString(),
    activeConstraintCount: rules.filter((rule) => rule.decision === "ACTIVE")
      .length,
    rules,
  };
}
