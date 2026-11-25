import { reference } from "./content.js";
import type {
  Constraint,
  Handoff,
  Manifest,
  RuleReference,
} from "./contracts.js";

export class InputError extends Error {
  override name = "InputError";
}

function fail(message: string): never {
  throw new InputError(message);
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${path}: expected an object`);
  }
  return value as Record<string, unknown>;
}

function keys(value: Record<string, unknown>, allowed: string[], path: string) {
  for (const key of Object.keys(value).sort()) {
    if (!allowed.includes(key)) fail(`${path}: unknown field '${key}'`);
  }
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) {
    fail(`${path}: expected a non-empty string`);
  }
  return value;
}

export function identifier(value: unknown, path: string): string {
  const result = string(value, path);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*(?![\s\S])/.test(result)) {
    fail(`${path}: use letters, digits, dots, underscores, or hyphens`);
  }
  return result;
}

export function timestamp(value: unknown, path: string): number {
  const result = string(value, path);
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/.exec(
    result,
  );
  if (!match) fail(`${path}: expected a UTC timestamp ending in Z`);
  const millis = Date.parse(result);
  const canonical = `${match[1]}.${(match[2] ?? "").padEnd(3, "0")}Z`;
  if (
    !Number.isFinite(millis) ||
    new Date(millis).toISOString() !== canonical
  ) {
    fail(`${path}: invalid calendar date or time`);
  }
  return millis;
}

function version(value: Record<string, unknown>, path: string, max: number) {
  if (
    !Number.isInteger(value.schemaVersion) ||
    (value.schemaVersion as number) < 1 ||
    (value.schemaVersion as number) > max
  )
    fail(`${path}.schemaVersion: expected 1 through ${max}`);
}

function revision(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1)
    fail(`${path}: expected a positive safe integer`);
  return value as number;
}

function unique(values: string[], path: string) {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) fail(`${path}: duplicate ID '${value}'`);
    seen.add(value);
  }
}

function parseConstraint(
  input: unknown,
  path: string,
  revisioned: boolean,
): Constraint {
  const rule = object(input, path);
  keys(
    rule,
    [
      "id",
      "scope",
      "description",
      "source",
      "expiresAt",
      "revokedAt",
      "replacedBy",
      "supersededAt",
      ...(revisioned ? ["revision"] : []),
    ],
    path,
  );
  const parsed: Constraint = {
    id: identifier(rule.id, `${path}.id`),
    scope: identifier(rule.scope, `${path}.scope`),
    description: string(rule.description, `${path}.description`),
    source: string(rule.source, `${path}.source`),
  };
  if (revisioned) parsed.revision = revision(rule.revision, `${path}.revision`);
  for (const field of ["expiresAt", "revokedAt", "supersededAt"] as const) {
    if (Object.hasOwn(rule, field)) {
      timestamp(rule[field], `${path}.${field}`);
      parsed[field] = rule[field] as string;
    }
  }
  if (Object.hasOwn(rule, "replacedBy")) {
    parsed.replacedBy = identifier(rule.replacedBy, `${path}.replacedBy`);
  }
  if (
    (parsed.replacedBy === undefined) !==
    (parsed.supersededAt === undefined)
  ) {
    fail(`${path}: replacedBy and supersededAt must be provided together`);
  }
  if (parsed.replacedBy === parsed.id)
    fail(`${path}: a rule cannot replace itself`);
  return parsed;
}

export function parseManifest(input: unknown): Manifest {
  const root = object(input, "manifest");
  keys(
    root,
    [
      "schemaVersion",
      "constraints",
      ...(root.schemaVersion === 3 ? ["projectId"] : []),
    ],
    "manifest",
  );
  version(root, "manifest", 3);
  const projectId =
    root.schemaVersion === 3
      ? identifier(root.projectId, "manifest.projectId")
      : undefined;
  if (!Array.isArray(root.constraints))
    fail("manifest.constraints: expected an array");
  const constraints: Constraint[] = root.constraints.map((entry, index) => {
    return parseConstraint(
      entry,
      `manifest.constraints[${index}]`,
      root.schemaVersion !== 1,
    );
  });
  unique(
    constraints.map((rule) => rule.id),
    "manifest.constraints",
  );
  const byId = new Map(constraints.map((rule) => [rule.id, rule]));
  for (const rule of constraints) {
    if (rule.replacedBy === undefined) continue;
    const replacement = byId.get(rule.replacedBy);
    if (!replacement)
      fail(
        `constraint '${rule.id}': replacement '${rule.replacedBy}' does not exist`,
      );
    if (replacement.scope !== rule.scope)
      fail(`constraint '${rule.id}': replacement must have the same scope`);
  }
  const completed = new Set<string>();
  for (const rule of constraints) {
    const path = new Set<string>();
    let current: Constraint | undefined = rule;
    while (current && !completed.has(current.id)) {
      if (path.has(current.id))
        fail(`constraint '${current.id}': replacement cycle`);
      path.add(current.id);
      current = current.replacedBy ? byId.get(current.replacedBy) : undefined;
    }
    for (const id of path) completed.add(id);
  }
  return {
    schemaVersion: root.schemaVersion as 1 | 2 | 3,
    ...(projectId === undefined ? {} : { projectId }),
    constraints,
  };
}

export function parseHandoff(input: unknown): Handoff {
  const root = object(input, "handoff");
  version(root, "handoff", 4);
  keys(
    root,
    [
      "schemaVersion",
      "task",
      "activeConstraints",
      ...(root.schemaVersion !== 1 ? ["scope", "capturedAt"] : []),
      ...(root.schemaVersion === 4 ? ["projectId", "contentMode"] : []),
    ],
    "handoff",
  );
  const task = string(root.task, "handoff.task");
  if (!Array.isArray(root.activeConstraints))
    fail("handoff.activeConstraints: expected an array");
  if (root.schemaVersion !== 1) {
    const projectId =
      root.schemaVersion === 4
        ? identifier(root.projectId, "handoff.projectId")
        : undefined;
    if (
      root.schemaVersion === 4 &&
      root.contentMode !== "hashes" &&
      root.contentMode !== "retained"
    )
      fail("handoff.contentMode: expected hashes or retained");
    const retained =
      root.schemaVersion === 3 ||
      (root.schemaVersion === 4 && root.contentMode === "retained");
    const scope = identifier(root.scope, "handoff.scope");
    timestamp(root.capturedAt, "handoff.capturedAt");
    const activeConstraints: RuleReference[] = root.activeConstraints.map(
      (entry, index) => {
        const path = `handoff.activeConstraints[${index}]`;
        const ref = object(entry, path);
        keys(
          ref,
          ["id", "revision", "contentHash", ...(retained ? ["content"] : [])],
          path,
        );
        const contentHash = string(ref.contentHash, `${path}.contentHash`);
        if (!/^sha256:[a-f0-9]{64}(?![\s\S])/.test(contentHash))
          fail(
            `${path}.contentHash: expected sha256 followed by 64 lowercase hex digits`,
          );
        const parsed = {
          id: identifier(ref.id, `${path}.id`),
          revision: revision(ref.revision, `${path}.revision`),
          contentHash,
        };
        if (retained) {
          const content = parseConstraint(ref.content, `${path}.content`, true);
          const expected = reference(content);
          if (
            expected.id !== parsed.id ||
            expected.revision !== parsed.revision ||
            expected.contentHash !== parsed.contentHash
          )
            fail(
              `${path}.content: id, revision and canonical hash must match the reference`,
            );
          return {
            ...parsed,
            content: content as Constraint & { revision: number },
          };
        }
        return parsed;
      },
    );
    unique(
      activeConstraints.map((ref) => ref.id),
      "handoff.activeConstraints",
    );
    return {
      schemaVersion: root.schemaVersion,
      ...(root.schemaVersion === 4
        ? { projectId, contentMode: root.contentMode }
        : {}),
      task,
      scope,
      capturedAt: root.capturedAt as string,
      activeConstraints,
    } as Handoff;
  }
  const activeConstraints = root.activeConstraints.map((id, index) =>
    identifier(id, `handoff.activeConstraints[${index}]`),
  );
  unique(activeConstraints, "handoff.activeConstraints");
  return { schemaVersion: 1, task, activeConstraints };
}
