import { afterAll, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Constraint } from "../src/contracts.js";
import { parseHandoff, parseManifest } from "../src/validation.js";
import { snapshot, verify } from "../src/verifier.js";

const time = "2026-11-24T10:00:00Z";
const rule: Constraint = {
  id: "A",
  revision: 1,
  scope: "staging",
  description: "Review migrations",
  source: "synthetic:active",
};
const manifest = (rules: Constraint[]) =>
  parseManifest({ schemaVersion: 2, constraints: rules });

test("count follows expected scope/global active rules rather than reported IDs", () => {
  const rules = [
    rule,
    { ...rule, id: "G", scope: "global" },
    { ...rule, id: "P", scope: "production" },
    { ...rule, id: "E", expiresAt: time },
    { ...rule, id: "R", revokedAt: time },
  ];
  const input = manifest(rules);
  const handoff = snapshot(input, "Resume", "staging", time);
  expect(verify(input, handoff, "staging", time).activeConstraintCount).toBe(2);
  const missing = verify(
    input,
    { ...handoff, activeConstraints: [] },
    "staging",
    time,
  );
  expect(missing.activeConstraintCount).toBe(2);
  expect(missing.findings.map((finding) => finding.code)).toEqual([
    "MISSING",
    "MISSING",
  ]);
  expect(
    verify(input, snapshot(input, "Resume", "global", time), "global", time)
      .activeConstraintCount,
  ).toBe(1);
  expect(
    verify(input, snapshot(input, "Resume", "absent", time), "absent", time)
      .activeConstraintCount,
  ).toBe(1);
});

test("empty default passes but explicit nonempty policy fails without fake rule IDs", () => {
  const input = manifest([]);
  const baseline = snapshot(input, "Resume", "staging", time);
  const normal = verify(input, baseline, "staging", time);
  expect(normal.status).toBe("verified");
  expect(normal.activeConstraintCount).toBe(0);
  expect(normal.findings).toEqual([]);
  const strict = verify(input, baseline, "staging", time, {
    requireActive: true,
  });
  expect(strict.status).toBe("mismatch");
  expect(strict.findings).toHaveLength(1);
  expect(strict.findings[0]?.code).toBe("NO_ACTIVE_CONSTRAINTS");
  expect(Object.hasOwn(strict.findings[0] ?? {}, "id")).toBe(false);
});

test("a populated manifest can have zero active constraints at selected scope/time", () => {
  for (const changes of [
    { scope: "production" },
    { expiresAt: time },
    { revokedAt: time },
  ]) {
    const input = manifest([{ ...rule, ...changes }]);
    const handoff = snapshot(input, "Resume", "staging", time);
    expect(verify(input, handoff, "staging", time).activeConstraintCount).toBe(
      0,
    );
    expect(
      verify(input, handoff, "staging", time, { requireActive: true })
        .findings[0]?.code,
    ).toBe("NO_ACTIVE_CONSTRAINTS");
  }
});

test("empty policy preserves stale-ID findings with deterministic global-first order", () => {
  const old = snapshot(manifest([rule]), "Resume", "staging", time);
  const inactive = manifest([{ ...rule, expiresAt: time }]);
  const ordinary = verify(inactive, old, "staging", time);
  expect(ordinary.activeConstraintCount).toBe(0);
  expect(ordinary.status).toBe("mismatch");
  expect(ordinary.findings.map((finding) => finding.code)).toEqual(["EXPIRED"]);
  const strict = verify(inactive, old, "staging", time, {
    requireActive: true,
  });
  expect(strict.findings.map((finding) => finding.code)).toEqual([
    "NO_ACTIVE_CONSTRAINTS",
    "EXPIRED",
  ]);
  expect(strict.findings[1]?.id).toBe("A");
  const unknown = verify(manifest([]), old, "staging", time, {
    requireActive: true,
  });
  expect(unknown.findings.map((finding) => finding.code)).toEqual([
    "NO_ACTIVE_CONSTRAINTS",
    "UNKNOWN",
  ]);
});

test("positive active set leaves content findings unchanged under nonempty policy", () => {
  const original = manifest([rule]);
  const baseline = snapshot(original, "Resume", "staging", time);
  const changed = manifest([{ ...rule, description: "Require two reviewers" }]);
  expect(
    verify(changed, baseline, "staging", time, { requireActive: true }),
  ).toEqual(verify(changed, baseline, "staging", time));
  expect(verify(changed, baseline, "staging", time).activeConstraintCount).toBe(
    1,
  );
});

test("legacy default JSON shape remains exact; policy applies to legacy too", () => {
  const input = parseManifest({ schemaVersion: 1, constraints: [] });
  const handoff = parseHandoff({
    schemaVersion: 1,
    task: "Resume",
    activeConstraints: [],
  });
  expect(verify(input, handoff, "staging", time)).toEqual({
    schemaVersion: 1,
    status: "verified",
    scope: "staging",
    asOf: "2026-11-24T10:00:00.000Z",
    expectedConstraints: [],
    reportedConstraints: [],
    findings: [],
  });
  const strict = verify(input, handoff, "staging", time, {
    requireActive: true,
  });
  expect(strict.schemaVersion).toBe(1);
  expect(strict.activeConstraintCount).toBeUndefined();
  expect(strict.findings[0]?.code).toBe("NO_ACTIVE_CONSTRAINTS");
});

const dirs: string[] = [];
afterAll(async () => {
  await Promise.all(
    dirs.map((dir) => rm(dir, { recursive: true, force: true })),
  );
});
const binary = resolve("dist/cli.js");
async function run(cwd: string, args: string[]) {
  const child = Bun.spawn(["node", binary, ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, code };
}

test("built CLI distinguishes empty checks and enforces optional policy on stdout", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "handoff-active-"));
  dirs.push(cwd);
  expect(
    (await run(cwd, ["init", "--scope", "staging", "--agent", "none"])).code,
  ).toBe(0);
  const ordinary = await run(cwd, ["verify"]);
  expect(ordinary.code).toBe(0);
  expect(ordinary.stdout).toContain("PASS (EMPTY)");
  expect(ordinary.stdout).toContain("0 active constraints checked");
  expect(ordinary.stdout).toContain(
    "No active constraints apply to this scope and time",
  );
  expect(ordinary.stderr).toBe("");
  const baselineBefore = await readFile(join(cwd, "handoff.json"), "utf8");
  const strict = await run(cwd, [
    "verify",
    "--require-active",
    "--format",
    "json",
  ]);
  expect(strict.code).toBe(1);
  const result = JSON.parse(strict.stdout);
  expect(result.activeConstraintCount).toBe(0);
  expect(result.status).toBe("mismatch");
  expect(result.findings[0].code).toBe("NO_ACTIVE_CONSTRAINTS");
  expect(result.findings[0].id).toBeUndefined();
  expect(strict.stderr).toBe("");
  const strictText = await run(cwd, ["verify", "--require-active"]);
  expect(strictText.code).toBe(1);
  expect(strictText.stdout).toContain("NO_ACTIVE_CONSTRAINTS");
  expect(strictText.stdout).not.toContain("undefined");
  await writeFile(
    join(cwd, "constraints.json"),
    JSON.stringify(manifest([rule])),
  );
  const missing = await run(cwd, [
    "verify",
    "--require-active",
    "--format",
    "json",
  ]);
  expect(missing.code).toBe(1);
  expect(JSON.parse(missing.stdout).activeConstraintCount).toBe(1);
  expect(
    JSON.parse(missing.stdout).findings.map(
      (finding: { code: string }) => finding.code,
    ),
  ).toEqual(["MISSING"]);
  expect(
    (await run(cwd, ["snapshot", "--task", "Resume", "--output", "next.json"]))
      .code,
  ).toBe(0);
  const passed = await run(cwd, [
    "verify",
    "--handoff",
    "next.json",
    "--require-active",
  ]);
  expect(passed.code).toBe(0);
  expect(passed.stdout).toContain(
    "PASS  1 active constraints checked | 0 findings",
  );
  expect(await readFile(join(cwd, "handoff.json"), "utf8")).toBe(
    baselineBefore,
  );
  for (const args of [
    ["init", "--require-active"],
    ["snapshot", "--task", "Resume", "--require-active"],
  ])
    expect((await run(cwd, args)).code).toBe(2);
});
