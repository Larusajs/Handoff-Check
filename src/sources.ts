import { reference } from "./content.js";
import type { Manifest, RuleReference } from "./contracts.js";
import { markdownText, terminalText } from "./render.js";
import { InputError, identifier, timestamp } from "./validation.js";
import { checkProject, explain } from "./verifier.js";

export const sourceLimit = 10 * 1024 * 1024;
export const bindingLimit = 256;
export interface SourceBinding {
  id: string;
  path: string;
}
export interface SourcePlan {
  schemaVersion: 1;
  projectId?: string;
  bindings: SourceBinding[];
}
export interface SourceEntry extends RuleReference {
  path: string;
  fileHash: string;
}
export interface SourceRegistry {
  schemaVersion: 1;
  projectId?: string;
  capturedAt: string;
  sources: SourceEntry[];
}
export type SourceError =
  | "SOURCE_MISSING"
  | "SOURCE_UNREADABLE"
  | "SOURCE_UNSAFE"
  | "SOURCE_TOO_LARGE";
export type SourceObservation =
  | { status: "READ"; fileHash: string; bytes: number }
  | { status: SourceError };
export type SourceStatus =
  | "UNCHANGED"
  | "SOURCE_CHANGED"
  | "MISSING_BINDING"
  | "STALE_BINDING"
  | SourceError;
export interface SourceResult {
  schemaVersion: 1;
  kind: "source-check";
  status: "unchanged" | "attention";
  projectId?: string;
  scope: string;
  asOf: string;
  activeConstraintCount: number;
  unchangedSourceCount: number;
  registryEntryCount: number;
  ignoredEntryCount: number;
  rules: {
    id: string;
    status: SourceStatus;
    expected: RuleReference;
    recorded?: RuleReference;
    path?: string;
    expectedFileHash?: string;
    observedFileHash?: string;
    observedBytes?: number;
  }[];
  findings: {
    code:
      | Exclude<SourceStatus, "UNCHANGED">
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
function hash(input: unknown, path: string): string {
  if (
    typeof input !== "string" ||
    !/^sha256:[a-f0-9]{64}(?![\s\S])/.test(input)
  )
    throw new InputError(`${path}: expected canonical sha256 reference`);
  return input;
}
export function sourcePath(input: unknown, path = "source path"): string {
  if (typeof input !== "string" || !input || Array.from(input).length > 1024)
    throw new InputError(
      `${path}: expected a relative portable path of 1 to 1024 characters`,
    );
  const parts = input.split("/");
  if (
    parts.some(
      (part) =>
        !part ||
        part === "." ||
        part === ".." ||
        Array.from(part).length > 255 ||
        /[\\:*?"<>|\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u.test(part) ||
        /[. ]$/.test(part) ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
    )
  )
    throw new InputError(
      `${path}: use a portable relative file path without traversal, URLs, reserved names or control characters`,
    );
  return input;
}
function root(
  input: unknown,
  field: "bindings" | "sources",
): { value: Record<string, unknown>; projectId?: string } {
  const value = object(
    input,
    [
      "schemaVersion",
      "projectId",
      field,
      ...(field === "sources" ? ["capturedAt"] : []),
    ],
    "source registry",
  );
  if (value.schemaVersion !== 1)
    throw new InputError("source registry.schemaVersion: expected 1");
  if (!Array.isArray(value[field]) || value[field].length > bindingLimit)
    throw new InputError(
      `source registry.${field}: expected an array with at most ${bindingLimit} entries`,
    );
  const projectId = Object.hasOwn(value, "projectId")
    ? identifier(value.projectId, "source registry.projectId")
    : undefined;
  return { value, ...(projectId === undefined ? {} : { projectId }) };
}
function entries(value: unknown[], retained: boolean) {
  const seen = new Set<string>();
  return value.map((input, index) => {
    const path = `source entries[${index}]`;
    const entry = object(
      input,
      [
        "id",
        "path",
        ...(retained ? ["revision", "contentHash", "fileHash"] : []),
      ],
      path,
    );
    const id = identifier(entry.id, `${path}.id`);
    if (seen.has(id)) throw new InputError(`${path}: duplicate ID '${id}'`);
    seen.add(id);
    return { entry, id, path: sourcePath(entry.path, `${path}.path`) };
  });
}
export function parseSourcePlan(input: unknown): SourcePlan {
  const { value, projectId } = root(input, "bindings");
  return {
    schemaVersion: 1,
    ...(projectId === undefined ? {} : { projectId }),
    bindings: entries(value.bindings as unknown[], false).map(
      ({ id, path }) => ({ id, path }),
    ),
  };
}
export function parseSourceRegistry(input: unknown): SourceRegistry {
  const { value, projectId } = root(input, "sources");
  const capturedAt = new Date(
    timestamp(value.capturedAt, "source registry.capturedAt"),
  ).toISOString();
  const sources = entries(value.sources as unknown[], true).map(
    ({ entry, id, path }): SourceEntry => {
      if (
        !Number.isSafeInteger(entry.revision) ||
        (entry.revision as number) < 1
      )
        throw new InputError(
          `source '${id}': expected a positive safe revision`,
        );
      return {
        id,
        path,
        revision: entry.revision as number,
        contentHash: hash(entry.contentHash, "contentHash"),
        fileHash: hash(entry.fileHash, "fileHash"),
      };
    },
  );
  return {
    schemaVersion: 1,
    ...(projectId === undefined ? {} : { projectId }),
    capturedAt,
    sources,
  };
}
function selection(
  manifest: Manifest,
  projectId: string | undefined,
  scope: string,
  asOf: string,
) {
  if (checkProject(manifest) !== projectId)
    throw new InputError(
      "Source metadata and manifest must have matching project binding (both bound or both unbound)",
    );
  const explanation = explain(manifest, scope, asOf);
  const active = new Set(
    explanation.rules.filter((r) => r.decision === "ACTIVE").map((r) => r.id),
  );
  return {
    explanation,
    active,
    rules: manifest.constraints
      .filter((r) => active.has(r.id))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  };
}
export function recordSourceTargets(
  manifest: Manifest,
  plan: SourcePlan,
  scope: string,
  asOf: string,
): Omit<SourceEntry, "fileHash">[] {
  const selected = selection(manifest, plan.projectId, scope, asOf);
  const known = new Set(manifest.constraints.map((r) => r.id));
  for (const binding of plan.bindings)
    if (!known.has(binding.id))
      throw new InputError(
        `Source binding '${binding.id}' does not exist in the manifest`,
      );
  if (!selected.rules.length)
    throw new InputError(
      "source-record requires at least one active constraint",
    );
  const paths = new Map(plan.bindings.map((b) => [b.id, b.path]));
  return selected.rules.map((rule) => {
    const path = paths.get(rule.id);
    if (path === undefined)
      throw new InputError(
        `Missing explicit source binding for active rule '${rule.id}'`,
      );
    return { ...reference(rule), path };
  });
}
export function sourceCheckTargets(
  manifest: Manifest,
  registry: SourceRegistry,
  scope: string,
  asOf: string,
): SourceEntry[] {
  const selected = selection(manifest, registry.projectId, scope, asOf);
  const byId = new Map(registry.sources.map((r) => [r.id, r]));
  return selected.rules.flatMap((rule) => {
    const entry = byId.get(rule.id);
    const expected = reference(rule);
    return entry &&
      entry.revision === expected.revision &&
      entry.contentHash === expected.contentHash
      ? [entry]
      : [];
  });
}
/** Observations come from the CLI; the core never opens a source or interprets text. */
export function checkSources(
  manifest: Manifest,
  registry: SourceRegistry,
  scope: string,
  asOf: string,
  observed: ReadonlyMap<string, SourceObservation>,
): SourceResult {
  const selected = selection(manifest, registry.projectId, scope, asOf);
  const byId = new Map(registry.sources.map((r) => [r.id, r]));
  const known = new Set(manifest.constraints.map((r) => r.id));
  const rules: SourceResult["rules"] = selected.rules.map((rule) => {
    const expected = reference(rule);
    const entry = byId.get(rule.id);
    if (!entry) return { id: rule.id, expected, status: "MISSING_BINDING" };
    const base = {
      id: rule.id,
      expected,
      recorded: {
        id: entry.id,
        revision: entry.revision,
        contentHash: entry.contentHash,
      },
      path: entry.path,
      expectedFileHash: entry.fileHash,
    };
    if (
      entry.revision !== expected.revision ||
      entry.contentHash !== expected.contentHash
    )
      return { ...base, status: "STALE_BINDING" };
    const observation = observed.get(entry.path);
    if (!observation)
      throw new InputError(`Missing source observation for '${rule.id}'`);
    if (observation.status !== "READ")
      return { ...base, status: observation.status };
    return {
      ...base,
      status:
        observation.fileHash === entry.fileHash
          ? "UNCHANGED"
          : "SOURCE_CHANGED",
      observedFileHash: observation.fileHash,
      observedBytes: observation.bytes,
    };
  });
  const findings: SourceResult["findings"] = [];
  if (!rules.length) findings.push({ code: "NO_ACTIVE_CONSTRAINTS" });
  for (const rule of rules)
    if (rule.status !== "UNCHANGED")
      findings.push({ id: rule.id, code: rule.status });
  for (const entry of registry.sources)
    if (!known.has(entry.id))
      findings.push({ id: entry.id, code: "UNKNOWN_RULE" });
  findings.sort((a, b) =>
    (a.id ?? "") < (b.id ?? "") ? -1 : (a.id ?? "") > (b.id ?? "") ? 1 : 0,
  );
  return {
    schemaVersion: 1,
    kind: "source-check",
    status: findings.length ? "attention" : "unchanged",
    ...(manifest.projectId === undefined
      ? {}
      : { projectId: manifest.projectId }),
    scope,
    asOf: selected.explanation.asOf,
    activeConstraintCount: rules.length,
    unchangedSourceCount: rules.filter((r) => r.status === "UNCHANGED").length,
    registryEntryCount: registry.sources.length,
    ignoredEntryCount: registry.sources.filter(
      (r) => known.has(r.id) && !selected.active.has(r.id),
    ).length,
    rules,
    findings,
    notice:
      "Explicit local whole-file byte comparison, not semantic policy validation, authenticated history or authorization. File changes signal review needed; no constraints or baselines are refreshed. Known inactive/stale bindings are not read. Other verification commands do not load this registry. Reads and filesystem checks are not an atomic sandbox against concurrent changes.",
  };
}
export function sourceText(result: SourceResult, markdown: boolean): string {
  const safe = markdown ? markdownText : terminalText;
  const lines = [
    markdown ? "# Handoff Check local sources\n" : "SOURCE CHECK",
    `${result.status.toUpperCase()} | ${result.unchangedSourceCount}/${result.activeConstraintCount} active rule sources unchanged | scope ${safe(result.scope)} | as of ${safe(result.asOf)}${result.projectId ? ` | project ${safe(result.projectId)}` : ""}`,
    `${result.registryEntryCount} registry entries | ${result.ignoredEntryCount} known inactive entries ignored`,
  ];
  for (const rule of result.rules)
    lines.push(
      `${rule.status} ${safe(rule.id)}${rule.path ? ` | ${safe(rule.path)}` : ""}${rule.observedFileHash ? ` | ${rule.observedFileHash}` : ""}`,
    );
  for (const finding of result.findings)
    if (!finding.id || finding.code === "UNKNOWN_RULE")
      lines.push(`${finding.code}${finding.id ? ` ${safe(finding.id)}` : ""}`);
  lines.push(safe(result.notice));
  return `${lines.join(markdown ? "\n\n" : "\n")}\n`;
}
