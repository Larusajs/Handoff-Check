import { reference } from "./content.js";
import type { Manifest, RuleReference } from "./contracts.js";
import { markdownText, terminalText } from "./render.js";
import { InputError, identifier, timestamp } from "./validation.js";
import { checkProject, explain } from "./verifier.js";

export interface ReviewEntry extends RuleReference {
  owner: string;
  reviewedAt: string;
  reviewBy: string;
}
export interface ReviewRegistry {
  schemaVersion: 1;
  projectId?: string;
  rules: ReviewEntry[];
}
export type ReviewStatus =
  | "CURRENT"
  | "MISSING_REVIEW"
  | "STALE_REVIEW"
  | "FUTURE_REVIEW"
  | "OVERDUE_REVIEW";
export interface ReviewResult {
  schemaVersion: 1;
  kind: "rule-review";
  status: "current" | "attention";
  projectId?: string;
  scope: string;
  asOf: string;
  activeConstraintCount: number;
  currentReviewCount: number;
  registryEntryCount: number;
  ignoredEntryCount: number;
  rules: {
    id: string;
    status: ReviewStatus;
    expected: RuleReference;
    recorded?: RuleReference;
    owner?: string;
    reviewedAt?: string;
    reviewBy?: string;
  }[];
  findings: {
    code:
      | Exclude<ReviewStatus, "CURRENT">
      | "UNKNOWN_RULE"
      | "NO_ACTIVE_CONSTRAINTS";
    id?: string;
  }[];
  notice: string;
}

function object(
  input: unknown,
  allowed: string[],
  path: string,
): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new InputError(`${path}: expected an object`);
  const value = input as Record<string, unknown>;
  for (const key of Object.keys(value).sort())
    if (!allowed.includes(key))
      throw new InputError(`${path}: unknown field '${key}'`);
  return value;
}
function text(input: unknown, path: string): string {
  if (typeof input !== "string" || !input.trim())
    throw new InputError(`${path}: expected a non-empty string`);
  return input;
}

export function parseReviewRegistry(input: unknown): ReviewRegistry {
  const root = object(
    input,
    ["schemaVersion", "projectId", "rules"],
    "review registry",
  );
  if (root.schemaVersion !== 1)
    throw new InputError("review registry.schemaVersion: expected 1");
  const projectId = Object.hasOwn(root, "projectId")
    ? identifier(root.projectId, "review registry.projectId")
    : undefined;
  if (!Array.isArray(root.rules))
    throw new InputError("review registry.rules: expected an array");
  const seen = new Set<string>();
  const rules = root.rules.map((input, index): ReviewEntry => {
    const path = `review registry.rules[${index}]`;
    const entry = object(
      input,
      ["id", "revision", "contentHash", "owner", "reviewedAt", "reviewBy"],
      path,
    );
    const id = identifier(entry.id, `${path}.id`);
    if (seen.has(id)) throw new InputError(`${path}: duplicate ID '${id}'`);
    seen.add(id);
    if (!Number.isSafeInteger(entry.revision) || (entry.revision as number) < 1)
      throw new InputError(
        `${path}.revision: expected a positive safe integer`,
      );
    const contentHash = text(entry.contentHash, `${path}.contentHash`);
    if (!/^sha256:[a-f0-9]{64}(?![\s\S])/.test(contentHash))
      throw new InputError(
        `${path}.contentHash: expected canonical sha256 reference`,
      );
    const reviewedAt = timestamp(entry.reviewedAt, `${path}.reviewedAt`);
    const reviewBy = timestamp(entry.reviewBy, `${path}.reviewBy`);
    if (reviewBy <= reviewedAt)
      throw new InputError(`${path}: reviewBy must be later than reviewedAt`);
    return {
      id,
      revision: entry.revision as number,
      contentHash,
      owner: text(entry.owner, `${path}.owner`),
      reviewedAt: new Date(reviewedAt).toISOString(),
      reviewBy: new Date(reviewBy).toISOString(),
    };
  });
  return {
    schemaVersion: 1,
    ...(projectId === undefined ? {} : { projectId }),
    rules,
  };
}

/** Explicitly record reviewed active references; never changes a manifest or handoff. */
export function recordReview(
  manifest: Manifest,
  scope: string,
  asOf: string,
  owner: string,
  reviewBy: string,
): ReviewRegistry {
  text(owner, "--owner");
  const explanation = explain(manifest, scope, asOf);
  const active = new Set(
    explanation.rules.filter((r) => r.decision === "ACTIVE").map((r) => r.id),
  );
  if (!active.size)
    throw new InputError(
      "review-record requires at least one active constraint; no review record created",
    );
  return parseReviewRegistry({
    schemaVersion: 1,
    ...(manifest.projectId === undefined
      ? {}
      : { projectId: manifest.projectId }),
    rules: manifest.constraints
      .filter((r) => active.has(r.id))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((rule) => ({
        ...reference(rule),
        owner,
        reviewedAt: explanation.asOf,
        reviewBy,
      })),
  });
}

/** Maintenance is independent of rule enforcement; overdue reviews never expire rules. */
export function reviewRules(
  manifest: Manifest,
  registry: ReviewRegistry,
  scope: string,
  asOf: string,
): ReviewResult {
  const projectId = checkProject(manifest);
  if (projectId !== registry.projectId)
    throw new InputError(
      "Review registry and manifest must have matching project binding (both bound or both unbound)",
    );
  const explanation = explain(manifest, scope, asOf);
  const time = timestamp(explanation.asOf, "asOf");
  const active = new Set(
    explanation.rules.filter((r) => r.decision === "ACTIVE").map((r) => r.id),
  );
  const known = new Set(manifest.constraints.map((r) => r.id));
  const entries = new Map(registry.rules.map((r) => [r.id, r]));
  const rules: ReviewResult["rules"] = manifest.constraints
    .filter((r) => active.has(r.id))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((rule) => {
      const expected = reference(rule);
      const entry = entries.get(rule.id);
      let status: ReviewStatus;
      if (!entry) status = "MISSING_REVIEW";
      else if (
        entry.revision !== expected.revision ||
        entry.contentHash !== expected.contentHash
      )
        status = "STALE_REVIEW";
      else if (timestamp(entry.reviewedAt, "reviewedAt") > time)
        status = "FUTURE_REVIEW";
      else if (timestamp(entry.reviewBy, "reviewBy") <= time)
        status = "OVERDUE_REVIEW";
      else status = "CURRENT";
      return {
        id: rule.id,
        status,
        expected,
        ...(entry
          ? {
              recorded: {
                id: entry.id,
                revision: entry.revision,
                contentHash: entry.contentHash,
              },
              owner: entry.owner,
              reviewedAt: entry.reviewedAt,
              reviewBy: entry.reviewBy,
            }
          : {}),
      };
    });
  const findings: ReviewResult["findings"] = [];
  if (!active.size) findings.push({ code: "NO_ACTIVE_CONSTRAINTS" });
  for (const rule of rules)
    if (rule.status !== "CURRENT")
      findings.push({ code: rule.status, id: rule.id });
  for (const entry of registry.rules)
    if (!known.has(entry.id))
      findings.push({ code: "UNKNOWN_RULE", id: entry.id });
  findings.sort((a, b) =>
    (a.id ?? "") < (b.id ?? "") ? -1 : (a.id ?? "") > (b.id ?? "") ? 1 : 0,
  );
  return {
    schemaVersion: 1,
    kind: "rule-review",
    status: findings.length ? "attention" : "current",
    ...(projectId === undefined ? {} : { projectId }),
    scope,
    asOf: explanation.asOf,
    activeConstraintCount: active.size,
    currentReviewCount: rules.filter((r) => r.status === "CURRENT").length,
    registryEntryCount: registry.rules.length,
    ignoredEntryCount: registry.rules.filter(
      (r) => known.has(r.id) && !active.has(r.id),
    ).length,
    rules,
    findings,
    notice:
      "Local maintenance record, not authenticated review or permission. Review deadlines never deactivate constraints or change verify/run results. Known inactive rules are ignored; orphan registry IDs require attention. Record only after reviewing the current rules; never refresh merely to clear findings.",
  };
}

export function reviewText(result: ReviewResult, markdown: boolean): string {
  const safe = markdown ? markdownText : terminalText;
  const lines = [
    markdown ? "# Handoff Check rule review\n" : "RULE REVIEW",
    `${result.status.toUpperCase()} | ${result.currentReviewCount}/${result.activeConstraintCount} active rules have current review | scope ${safe(result.scope)} | as of ${safe(result.asOf)}${result.projectId ? ` | project ${safe(result.projectId)}` : ""}`,
    `${result.registryEntryCount} registry entries | ${result.ignoredEntryCount} known inactive entries ignored`,
  ];
  for (const rule of result.rules) {
    lines.push(
      `${rule.status} ${safe(rule.id)}${rule.owner === undefined ? "" : ` | owner ${safe(rule.owner)} | reviewed ${safe(rule.reviewedAt ?? "")} | review by ${safe(rule.reviewBy ?? "")}`}`,
    );
    if (rule.status === "MISSING_REVIEW" || rule.status === "STALE_REVIEW")
      lines.push(
        `  Current reference: revision ${rule.expected.revision} ${rule.expected.contentHash}`,
      );
  }
  for (const finding of result.findings)
    if (!finding.id || finding.code === "UNKNOWN_RULE")
      lines.push(`${finding.code}${finding.id ? ` ${safe(finding.id)}` : ""}`);
  lines.push(safe(result.notice));
  return `${lines.join(markdown ? "\n\n" : "\n")}\n`;
}
