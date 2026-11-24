import { afterAll, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { reference } from "../src/content.js";
import type { Constraint } from "../src/contracts.js";
import { parseHandoff, parseManifest } from "../src/validation.js";
import { snapshot, verify } from "../src/verifier.js";

const time = "2026-11-24T10:00:00Z";
const rule: Constraint = {
  id: "C-07",
  scope: "staging",
  description: "Review migrations",
  source: "decision:review",
  revision: 1,
};
const manifest = (rules: Constraint[] = [rule]) =>
  parseManifest({ schemaVersion: 2, constraints: rules });
const captured = () =>
  snapshot(manifest(), "Resume migration review", "staging", time);

test("content hash has an independent golden vector and ignores only revision", () => {
  expect(reference(rule).contentHash).toBe(
    "sha256:2e1217c01957cd82f81d2bdc47397e00d7c56399606f38545384bdab07ee1b3d",
  );
  expect(reference({ ...rule, revision: 2 }).contentHash).toBe(
    reference(rule).contentHash,
  );
  const reordered = {
    source: rule.source,
    description: rule.description,
    scope: rule.scope,
    revision: 1,
    id: rule.id,
  };
  expect(reference(reordered)).toEqual(reference(rule));
  expect(
    reference({ ...rule, expiresAt: "2026-12-01T00:00:00Z" }).contentHash,
  ).toBe(
    reference({ ...rule, expiresAt: "2026-12-01T00:00:00.000Z" }).contentHash,
  );
});

test.each([
  { id: "C-08" },
  { scope: "global" },
  { description: "Require two reviewers" },
  { description: "Review migrations " },
  { source: "decision:new" },
  { expiresAt: "2026-12-01T00:00:00Z" },
  { revokedAt: "2026-12-01T00:00:00Z" },
  { replacedBy: "C-08", supersededAt: "2026-12-01T00:00:00Z" },
])("all review-relevant fields affect content hash %#", (change) => {
  expect(reference({ ...rule, ...change }).contentHash).not.toBe(
    reference(rule).contentHash,
  );
});

test("unchanged refs pass; same-ID edits without revision bump fail CHANGED", () => {
  const handoff = captured();
  expect(verify(manifest(), handoff, "staging", time).status).toBe("verified");
  const result = verify(
    manifest([{ ...rule, description: "Require two reviewers" }]),
    handoff,
    "staging",
    time,
  );
  expect(result.schemaVersion).toBe(2);
  expect(result.tracking).toBe("content");
  expect(result.findings.map((finding) => finding.code)).toEqual(["CHANGED"]);
  expect(result.findings[0]?.reported?.revision).toBe(1);
  expect(result.findings[0]?.expected?.contentHash).not.toBe(
    result.findings[0]?.reported?.contentHash,
  );
});

test("revision changes and regressions are detected independently of content", () => {
  const result = verify(
    manifest([{ ...rule, revision: 2 }]),
    captured(),
    "staging",
    time,
  );
  expect(result.findings[0]?.code).toBe("CHANGED");
  expect(result.findings[0]?.expected?.contentHash).toBe(
    result.findings[0]?.reported?.contentHash,
  );
  const newer = snapshot(
    manifest([{ ...rule, revision: 2 }]),
    "Resume",
    "staging",
    time,
  );
  expect(verify(manifest(), newer, "staging", time).findings[0]?.code).toBe(
    "CHANGED",
  );
});

test("inactive findings precede content changes and missing/unknown retain meaning", () => {
  const handoff = captured();
  for (const [change, expected] of [
    [{ expiresAt: time }, "EXPIRED"],
    [{ revokedAt: time }, "REVOKED"],
    [{ scope: "production" }, "OUT_OF_SCOPE"],
  ] as const) {
    expect(
      verify(
        manifest([{ ...rule, ...change, description: "Changed" }]),
        handoff,
        "staging",
        time,
      ).findings.map((finding) => finding.code),
    ).toEqual([expected]);
  }
  const replacement = { ...rule, id: "C-08" };
  const replaced = manifest([
    { ...rule, replacedBy: replacement.id, supersededAt: time },
    replacement,
  ]);
  expect(
    verify(replaced, handoff, "staging", time).findings.map(
      (finding) => finding.code,
    ),
  ).toEqual(["SUPERSEDED", "MISSING"]);
  expect(
    verify(
      manifest([{ ...rule, id: "C-08" }]),
      handoff,
      "staging",
      time,
    ).findings.map((finding) => finding.code),
  ).toEqual(["UNKNOWN", "MISSING"]);
  expect(
    verify(
      manifest([{ ...rule, revokedAt: "2026-12-01T00:00:00Z" }]),
      handoff,
      "staging",
      time,
    ).findings[0]?.code,
  ).toBe("CHANGED");
});

test("both manifest formats work with content handoffs; legacy ID mode stays unchanged", () => {
  const { revision: _, ...legacyRule } = rule;
  const legacy = parseManifest({ schemaVersion: 1, constraints: [legacyRule] });
  const handoff = snapshot(legacy, "Resume", "staging", time);
  expect(handoff.activeConstraints[0]?.revision).toBe(1);
  expect(verify(legacy, handoff, "staging", time).status).toBe("verified");
  expect(verify(manifest(), handoff, "staging", time).status).toBe("verified");
  for (const input of [legacy, manifest()]) {
    const result = verify(
      input,
      { schemaVersion: 1, task: "Resume", activeConstraints: [rule.id] },
      "staging",
      time,
    );
    expect(result.schemaVersion).toBe(1);
    expect(result.tracking).toBeUndefined();
    expect(result.status).toBe("verified");
  }
});

test("snapshot selection is deterministic and capture time never becomes verification time", () => {
  const rules = [
    rule,
    { ...rule, id: "A", scope: "global" },
    { ...rule, id: "X", expiresAt: time },
    { ...rule, id: "Y", scope: "production" },
  ];
  const first = snapshot(manifest(rules), "Resume", "staging", time);
  expect(first.activeConstraints.map((ref) => ref.id)).toEqual(["A", "C-07"]);
  expect(first).toEqual(
    snapshot(manifest([...rules].reverse()), "Resume", "staging", time),
  );
  expect(first.capturedAt).toBe("2026-11-24T10:00:00.000Z");
  expect(() => verify(manifest(rules), first, "production", time)).toThrow(
    "scope",
  );
  expect(
    verify(manifest(), captured(), "staging", "2026-11-24T09:00:00Z").asOf,
  ).toBe("2026-11-24T09:00:00.000Z");
});

test.each([0, -1, 1.2, "1", null, 9007199254740992])(
  "unsafe/invalid revisions reject %#",
  (revision) => {
    expect(() =>
      parseManifest({ schemaVersion: 2, constraints: [{ ...rule, revision }] }),
    ).toThrow();
    const handoff = captured();
    expect(() =>
      parseHandoff({
        ...handoff,
        activeConstraints: [{ ...handoff.activeConstraints[0], revision }],
      }),
    ).toThrow();
  },
);

test("malformed and duplicate content refs are invalid input", () => {
  const handoff = captured();
  for (const ref of [
    { id: rule.id, revision: 1 },
    { ...handoff.activeConstraints[0], contentHash: "sha256:BAD" },
    { ...handoff.activeConstraints[0], extra: true },
  ]) {
    expect(() =>
      parseHandoff({ ...handoff, activeConstraints: [ref] }),
    ).toThrow();
  }
  expect(() =>
    parseHandoff({
      ...handoff,
      activeConstraints: [
        ...handoff.activeConstraints,
        ...handoff.activeConstraints,
      ],
    }),
  ).toThrow("duplicate");
  expect(() => parseHandoff({ ...handoff, capturedAt: "yesterday" })).toThrow();
  expect(() =>
    parseManifest({
      schemaVersion: 2,
      constraints: [
        {
          id: rule.id,
          scope: rule.scope,
          description: rule.description,
          source: rule.source,
        },
      ],
    }),
  ).toThrow("revision");
});

const dirs: string[] = [];
afterAll(async () => {
  await Promise.all(
    dirs.map((path) => rm(path, { recursive: true, force: true })),
  );
});
const cliPath = resolve("dist/cli.js");
async function run(cwd: string, args: string[]) {
  const child = Bun.spawn(["node", cliPath, ...args], {
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

test("built CLI snapshots new baselines, refuses overwrites, and detects changed content", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "handoff-content-"));
  dirs.push(cwd);
  await writeFile(join(cwd, "constraints.json"), JSON.stringify(manifest()));
  const args = [
    "snapshot",
    "--scope",
    "staging",
    "--task",
    "Resume",
    "--as-of",
    time,
  ];
  const stdout = await run(cwd, args);
  expect(stdout.code).toBe(0);
  expect(JSON.parse(stdout.stdout).schemaVersion).toBe(2);
  expect(await readdir(cwd)).toEqual(["constraints.json"]);
  expect((await run(cwd, [...args, "--output", "handoff.json"])).code).toBe(0);
  const before = await readFile(join(cwd, "handoff.json"), "utf8");
  expect((await run(cwd, [...args, "--output", "handoff.json"])).code).toBe(2);
  expect(await readFile(join(cwd, "handoff.json"), "utf8")).toBe(before);
  const verifyArgs = [
    "verify",
    "--scope",
    "staging",
    "--as-of",
    time,
    "--require-content",
    "--format",
    "json",
  ];
  expect((await run(cwd, verifyArgs)).code).toBe(0);
  await writeFile(
    join(cwd, "constraints.json"),
    JSON.stringify(
      manifest([{ ...rule, description: "Two reviewers required" }]),
    ),
  );
  const changed = await run(cwd, verifyArgs);
  expect(changed.code).toBe(1);
  expect(JSON.parse(changed.stdout).findings[0].code).toBe("CHANGED");
  expect(changed.stderr).toBe("");
  expect(await readFile(join(cwd, "handoff.json"), "utf8")).toBe(before);
  await writeFile(
    join(cwd, "handoff.json"),
    JSON.stringify({
      schemaVersion: 1,
      task: "Resume",
      activeConstraints: [rule.id],
    }),
  );
  expect((await run(cwd, verifyArgs)).code).toBe(2);
  expect((await run(cwd, ["verify", "--scope", "staging"])).code).toBe(0);
  for (const invalid of [
    ["snapshot", "--scope", "staging"],
    [...args, "--handoff", "other.json"],
    [...args, "--require-content"],
    [...args, "--output", " "],
    ["verify", "--scope", "staging", "--task", "Resume"],
  ])
    expect((await run(cwd, invalid)).code).toBe(2);
});
