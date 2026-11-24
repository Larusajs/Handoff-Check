import type { Constraint, Handoff, Manifest } from "./contracts.js";

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

function version(value: Record<string, unknown>, path: string) {
  if (value.schemaVersion !== 1) fail(`${path}.schemaVersion: expected 1`);
}

function unique(values: string[], path: string) {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) fail(`${path}: duplicate ID '${value}'`);
    seen.add(value);
  }
}

export function parseManifest(input: unknown): Manifest {
  const root = object(input, "manifest");
  keys(root, ["schemaVersion", "constraints"], "manifest");
  version(root, "manifest");
  if (!Array.isArray(root.constraints))
    fail("manifest.constraints: expected an array");
  const constraints: Constraint[] = root.constraints.map((entry, index) => {
    const path = `manifest.constraints[${index}]`;
    const rule = object(entry, path);
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
      ],
      path,
    );
    const parsed: Constraint = {
      id: identifier(rule.id, `${path}.id`),
      scope: identifier(rule.scope, `${path}.scope`),
      description: string(rule.description, `${path}.description`),
      source: string(rule.source, `${path}.source`),
    };
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
    return parsed;
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
  return { schemaVersion: 1, constraints };
}

export function parseHandoff(input: unknown): Handoff {
  const root = object(input, "handoff");
  keys(root, ["schemaVersion", "task", "activeConstraints"], "handoff");
  version(root, "handoff");
  const task = string(root.task, "handoff.task");
  if (!Array.isArray(root.activeConstraints))
    fail("handoff.activeConstraints: expected an array");
  const activeConstraints = root.activeConstraints.map((id, index) =>
    identifier(id, `handoff.activeConstraints[${index}]`),
  );
  unique(activeConstraints, "handoff.activeConstraints");
  return { schemaVersion: 1, task, activeConstraints };
}
