import { expect, test } from "bun:test";
import {
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import diffSchema from "../schemas/diff.v1.schema.json" with { type: "json" };
import type { Constraint } from "../src/contracts.js";
import { diffSnapshots, diffText } from "../src/diff.js";
import { setupPlan, writeSetup } from "../src/setup.js";
import { parseHandoff, parseManifest } from "../src/validation.js";
import { snapshot, verify } from "../src/verifier.js";

const clock = "2026-11-26T08:00:00Z";
const rule = {
  id: "rule-a",
  scope: "global",
  description: "Review migrations",
  source: "policy.md",
  revision: 1,
};
const capture = (
  rules: Constraint[] = [rule],
  retained = true,
  projectId?: string,
) =>
  snapshot(
    parseManifest({
      schemaVersion: projectId ? 3 : 2,
      ...(projectId ? { projectId } : {}),
      constraints: rules,
    }),
    "Task",
    "staging",
    clock,
    { includeContent: retained },
  );
const answers = {
  projectId: "demo",
  scopes: ["staging", "production"],
  ruleId: "migration-review",
  description: "Review migrations",
  source: "policy.md",
  task: "Initial task",
};
const cli = resolve("dist/cli.js");
async function run(cwd: string, args: string[]) {
  const child = Bun.spawn(["node", cli, ...args], {
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    code: await child.exited,
    out: await new Response(child.stdout).text(),
    err: await new Response(child.stderr).text(),
  };
}

test("snapshot diff orders additions, removals and retained field changes", () => {
  const before = capture([rule, { ...rule, id: "removed" }]);
  const after = capture([
    { ...rule, description: "New rule", revision: 2 },
    { ...rule, id: "added" },
  ]);
  const result = diffSnapshots(before, after);
  expect(result.changes.map((c) => [c.id, c.kind])).toEqual([
    ["added", "ADDED"],
    ["removed", "REMOVED"],
    ["rule-a", "CHANGED"],
  ]);
  expect(result.changes[2]?.fields).toEqual([
    { field: "description", before: "Review migrations", after: "New rule" },
    { field: "revision", before: 1, after: 2 },
  ]);
  expect(result.unchangedCount).toBe(0);
  expect(before.activeConstraints).toHaveLength(2);
  const validate = new Ajv2020({ allowUnionTypes: true }).compile(diffSchema);
  expect(validate(result)).toBe(true);
  expect(validate({ ...result, scope: "bad:scope" })).toBe(false);
  expect(validate({ ...result, scope: "staging\n" })).toBe(false);
  const invalid = structuredClone(result);
  if (invalid.changes[0]) invalid.changes[0].before = invalid.changes[0].after;
  expect(validate(invalid)).toBe(false);
});

test("metadata alone and equivalent timestamps are unchanged, including empty snapshots", () => {
  const before = capture([{ ...rule, expiresAt: "2030-01-01T00:00:00Z" }]);
  const after = capture([{ ...rule, expiresAt: "2030-01-01T00:00:00.000Z" }]);
  after.task = "Other task";
  after.capturedAt = "2020-01-01T00:00:00Z";
  expect(diffSnapshots(before, after).status).toBe("unchanged");
  expect(diffSnapshots(before, after).unchangedCount).toBe(1);
  expect(diffSnapshots(capture([]), capture([])).status).toBe("unchanged");
});

test("diff ignores declaration ordering, preserves inputs and returns typed optional-field removal", () => {
  const before = capture([
    { ...rule, expiresAt: "2030-01-01T00:00:00Z" },
    { ...rule, id: "second" },
  ]);
  const after = capture([{ ...rule, id: "second" }, rule]);
  const saved = JSON.stringify([before, after]);
  const result = diffSnapshots(before, after);
  expect(result.unchangedCount).toBe(1);
  expect(result.changes[0]?.fields).toEqual([
    { field: "expiresAt", before: "2030-01-01T00:00:00.000Z", after: null },
  ]);
  expect(JSON.stringify([before, after])).toBe(saved);
});

test("hash-only and one-sided retention detect changes without inventing fields", () => {
  for (const a of [false, true])
    for (const b of [false, true]) {
      const result = diffSnapshots(
        capture([rule], a),
        capture([{ ...rule, revision: 2 }], b),
      );
      expect(result.status).toBe("different");
      expect(result.changes[0]?.fields !== undefined).toBe(a && b);
      if (!(a && b))
        expect(diffText(result, false)).toContain("Field details unavailable");
    }
});

test("diff rejects legacy, wrong scope, mixed and different project binding", () => {
  expect(() =>
    diffSnapshots(
      parseHandoff({ schemaVersion: 1, task: "Legacy", activeConstraints: [] }),
      capture(),
    ),
  ).toThrow("content-aware");
  const scoped = capture();
  scoped.scope = "production";
  expect(() => diffSnapshots(capture(), scoped)).toThrow("same scope");
  expect(() => diffSnapshots(capture(), capture([rule], true, "demo"))).toThrow(
    "project binding",
  );
  expect(() =>
    diffSnapshots(
      capture([rule], false, "demo"),
      capture([rule], true, "other"),
    ),
  ).toThrow("project binding");
  expect(
    diffSnapshots(capture([rule], false, "demo"), capture([rule], true, "demo"))
      .projectId,
  ).toBe("demo");
});

test("diff renders hostile field data safely", () => {
  const result = diffSnapshots(
    capture(),
    capture([
      {
        ...rule,
        description: "<script>\n# [click](https://evil.test)\u001b\u202e",
      },
    ]),
  );
  expect(diffText(result, false)).not.toContain("\u001b");
  expect(diffText(result, true)).not.toContain("<script>");
  expect(diffText(result, true)).not.toContain("[click]");
});

test("setup plan validates and creates real bound retained baselines for explicit profiles", () => {
  const plan = setupPlan(answers, clock);
  expect(plan.map((f) => f.path)).toEqual([
    ".handoff-check.json",
    "constraints.json",
    "handoff-staging.json",
    "handoff-production.json",
  ]);
  const manifest = parseManifest(JSON.parse(plan[1]?.content ?? ""));
  for (const file of plan.slice(2)) {
    const handoff = parseHandoff(JSON.parse(file.content));
    expect(handoff.schemaVersion).toBe(4);
    expect(
      verify(
        manifest,
        handoff,
        file.path.includes("staging") ? "staging" : "production",
        clock,
        { requireActive: true },
      ).status,
    ).toBe("verified");
  }
  for (const scopes of [
    [],
    ["same", "same"],
    ["Stage", "stage"],
    ["../escape"],
  ])
    expect(() => setupPlan({ ...answers, scopes }, clock)).toThrow();
  expect(() => setupPlan({ ...answers, description: "" }, clock)).toThrow();
});

test("setup preserves all inputs on conflicts and dangling symlinks; successful writes match preview bytes", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "handoff-setup-"));
  try {
    const files = setupPlan(answers, clock);
    await symlink(join(cwd, "missing"), join(cwd, "handoff-production.json"));
    await expect(writeSetup(cwd, files)).rejects.toThrow("already exists");
    expect(await readdir(cwd)).toEqual(["handoff-production.json"]);
    await rm(join(cwd, "handoff-production.json"));
    await writeSetup(cwd, files);
    for (const file of files)
      expect(await readFile(join(cwd, file.path), "utf8")).toBe(file.content);
    await expect(writeSetup(cwd, files)).rejects.toThrow("already exists");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("CLI diff exit codes, strict options, malformed input and noninteractive setup", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "handoff-diff-cli-"));
  try {
    await writeFile(join(cwd, "before.json"), JSON.stringify(capture()));
    await writeFile(
      join(cwd, "after.json"),
      JSON.stringify(capture([{ ...rule, revision: 2 }])),
    );
    const args = ["diff", "--before", "before.json", "--after", "after.json"];
    const result = await run(cwd, [...args, "--format", "json"]);
    expect(result.code).toBe(1);
    expect(JSON.parse(result.out).changes[0].kind).toBe("CHANGED");
    expect(result.err).toBe("");
    expect(
      (
        await run(cwd, [
          "diff",
          "--before",
          "before.json",
          "--after",
          "before.json",
        ])
      ).code,
    ).toBe(0);
    expect((await run(cwd, [...args, "--scope", "staging"])).code).toBe(2);
    expect((await run(cwd, ["diff"])).code).toBe(2);
    expect((await run(cwd, ["setup"])).err).toContain("interactive terminal");
    expect((await run(cwd, ["setup", "--format", "json"])).code).toBe(2);
    expect((await run(cwd, ["verify", "--before", "before.json"])).code).toBe(
      2,
    );
    await writeFile(join(cwd, "after.json"), "{}");
    expect((await run(cwd, args)).code).toBe(2);
    expect((await readdir(cwd)).sort()).toEqual(["after.json", "before.json"]);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
