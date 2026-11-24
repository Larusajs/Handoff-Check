import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { fullFormats } from "ajv-formats/dist/formats.js";
import schema from "../schemas/handoff.v3.schema.json" with { type: "json" };
import { reference } from "../src/content.js";
import type { Constraint } from "../src/contracts.js";
import { explanationText, verificationMarkdown } from "../src/render.js";
import { parseHandoff, parseManifest } from "../src/validation.js";
import { explain, snapshot, verify } from "../src/verifier.js";

const clock = "2026-11-24T10:00:00Z";
const rule: Constraint = {
  id: "C-01",
  scope: "staging",
  revision: 1,
  description: "Review migrations",
  source: "synthetic:review",
};
const manifest = (rules: Constraint[] = [rule]) =>
  parseManifest({ schemaVersion: 2, constraints: rules });
const capture = (rules: Constraint[] = [rule]) =>
  snapshot(manifest(rules), "Resume", "staging", clock, {
    includeContent: true,
  });

test("retention is explicit, independently copied, normalized, and schema validated", () => {
  const m = manifest([{ ...rule, expiresAt: "2027-01-01T00:00:00Z" }]);
  const before = JSON.stringify(m);
  expect(snapshot(m, "Resume", "staging", clock).schemaVersion).toBe(2);
  const h = snapshot(m, "Resume", "staging", clock, { includeContent: true });
  expect(h.schemaVersion).toBe(3);
  expect(h.activeConstraints[0]?.content.expiresAt).toBe(
    "2027-01-01T00:00:00.000Z",
  );
  expect(h.activeConstraints[0]?.contentHash).toBe(
    reference(m.constraints[0] as Constraint).contentHash,
  );
  const ajv = new Ajv2020();
  ajv.addFormat("date-time", fullFormats["date-time"]);
  const validate = ajv.compile(schema);
  expect(validate(h)).toBe(true);
  expect(parseHandoff(h)).toEqual(h);
  if (h.activeConstraints[0])
    h.activeConstraints[0].content.description = "Changed copy";
  expect(JSON.stringify(m)).toBe(before);
  expect(() => parseHandoff(h)).toThrow("canonical hash");
  for (const content of [
    null,
    { ...rule, revision: 0 },
    { ...rule, extra: true },
    { ...rule, source: null },
    { ...rule, replacedBy: "C-01", supersededAt: clock },
  ]) {
    const invalid = {
      ...capture(),
      activeConstraints: [{ ...capture().activeConstraints[0], content }],
    };
    expect(() => parseHandoff(invalid)).toThrow();
  }
  const invalidSchema = capture();
  delete (
    invalidSchema.activeConstraints[0] as unknown as Record<string, unknown>
  ).content;
  expect(validate(invalidSchema)).toBe(false);
  expect(() => parseHandoff(invalidSchema)).toThrow();
});

test("retained standalone rules allow absent replacement targets and enforce reference agreement", () => {
  const content = {
    ...rule,
    replacedBy: "C-02",
    supersededAt: "2027-01-01T00:00:00Z",
  };
  const h = {
    ...capture(),
    activeConstraints: [{ ...reference(content), content }],
  };
  expect(() => parseHandoff(h)).not.toThrow();
  for (const override of [
    { id: "other" },
    { revision: 2 },
    { contentHash: `sha256:${"0".repeat(64)}` },
  ]) {
    expect(() =>
      parseHandoff({
        ...h,
        activeConstraints: [{ ...h.activeConstraints[0], ...override }],
      }),
    ).toThrow();
  }
  expect(() =>
    parseHandoff({
      ...h,
      activeConstraints: [...h.activeConstraints, ...h.activeConstraints],
    }),
  ).toThrow("duplicate");
  expect(() => parseHandoff({ ...h, schemaVersion: 2 })).toThrow(
    "unknown field",
  );
  expect(() =>
    parseManifest({ schemaVersion: 3, constraints: [rule] }),
  ).toThrow();
});

test("v3 changes have stable typed field deltas; lifecycle still takes precedence", () => {
  const h = capture([{ ...rule, expiresAt: "2027-01-01T00:00:00Z" }]);
  const changed = manifest([
    {
      ...rule,
      description: "Two reviews",
      source: "synthetic:new",
      revision: 2,
      revokedAt: "2027-02-01T00:00:00Z",
    },
  ]);
  const result = verify(changed, h, "staging", clock);
  expect(result.schemaVersion).toBe(3);
  expect(result.findings[0]).toMatchObject({
    code: "CHANGED",
    changes: [
      {
        field: "description",
        before: "Review migrations",
        after: "Two reviews",
      },
      { field: "source", before: "synthetic:review", after: "synthetic:new" },
      { field: "expiresAt", before: "2027-01-01T00:00:00.000Z", after: null },
      { field: "revokedAt", before: null, after: "2027-02-01T00:00:00.000Z" },
      { field: "revision", before: 1, after: 2 },
    ],
  });
  expect(
    verify(changed, h, "staging", "2027-02-01T00:00:00Z").findings[0],
  ).toMatchObject({ code: "REVOKED" });
  expect(
    verify(changed, h, "staging", "2027-02-01T00:00:00Z").findings[0],
  ).not.toHaveProperty("changes");
  expect(() => verify(changed, h, "production", clock)).toThrow("scope");
  expect(
    verify(manifest([{ ...rule, revision: 2 }]), capture(), "staging", clock)
      .findings[0],
  ).toMatchObject({ changes: [{ field: "revision", before: 1, after: 2 }] });
  expect(
    verify(
      manifest([{ ...rule, expiresAt: "2027-01-01T00:00:00.000Z" }]),
      h,
      "staging",
      clock,
    ).status,
  ).toBe("verified");
});

test("explain agrees with verify at boundaries and shares lifecycle precedence", () => {
  const m = manifest([
    { ...rule, id: "Z", scope: "production", revokedAt: clock },
    { ...rule, id: "R", revokedAt: clock, expiresAt: clock },
    {
      ...rule,
      id: "S",
      replacedBy: "C-01",
      supersededAt: clock,
      expiresAt: clock,
    },
    { ...rule, id: "E", expiresAt: clock },
    rule,
    { ...rule, id: "G", scope: "global" },
  ]);
  const frozen = JSON.stringify(m);
  for (const at of [
    "2026-11-24T09:59:59.999Z",
    clock,
    "2026-11-24T10:00:00.001Z",
  ]) {
    const e = explain(m, "staging", at);
    const v = verify(
      m,
      { schemaVersion: 1, task: "Resume", activeConstraints: [] },
      "staging",
      at,
    );
    expect(
      e.rules.filter((r) => r.decision === "ACTIVE").map((r) => r.id),
    ).toEqual(v.expectedConstraints);
    expect(e.activeConstraintCount).toBe(v.expectedConstraints.length);
    expect(
      explain(
        { ...m, constraints: [...m.constraints].reverse() },
        "staging",
        at,
      ),
    ).toEqual(e);
  }
  expect(
    explain(m, "staging", clock).rules.map((r) => [r.id, r.decision]),
  ).toEqual([
    ["C-01", "ACTIVE"],
    ["E", "EXPIRED"],
    ["G", "ACTIVE"],
    ["R", "REVOKED"],
    ["S", "SUPERSEDED"],
    ["Z", "OUT_OF_SCOPE"],
  ]);
  expect(JSON.stringify(m)).toBe(frozen);
});

test("Markdown safely renders hostile input and distinguishes unavailable old content", () => {
  const hostile =
    "<img src=x onerror=alert(1)>\n|row| [click](https://example.com) ``` #title & &#10; \u001b\u202e";
  const m = manifest([{ ...rule, description: hostile, source: hostile }]);
  const old = snapshot(m, hostile, "staging", clock);
  const h = snapshot(m, hostile, "staging", clock, { includeContent: true });
  const current = manifest([{ ...rule, description: "Updated" }]);
  const md = verificationMarkdown(
    verify(current, h, "staging", clock),
    h,
    true,
    true,
  );
  const em = explanationText(explain(m, "staging", clock), true);
  for (const output of [md, em]) {
    for (const token of [
      "<img",
      "[click]",
      "https://",
      "```",
      "\u001b",
      "\u202e",
      "\n|row|",
    ])
      expect(output).not.toContain(token);
    expect(output).toContain("&#60;img");
    expect(output).toContain("&#38; &#38;&#35;10;");
  }
  expect(
    verificationMarkdown(
      verify(current, old, "staging", clock),
      old,
      false,
      true,
    ),
  ).toContain("Previous content unavailable");
  expect(md).toContain("Before (saved)");
});

const cli = resolve("dist/cli.js");
async function run(cwd: string, args: string[]) {
  const p = Bun.spawn(["node", cli, ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    code: await p.exited,
    stdout: await new Response(p.stdout).text(),
    stderr: await new Response(p.stderr).text(),
  };
}

test("Node CLI explains without a handoff and supports opt-in diffs and Markdown exit codes", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "handoff04-"));
  try {
    await writeFile(join(cwd, "constraints.json"), JSON.stringify(manifest()));
    const args = ["--scope", "staging", "--as-of", clock];
    const e = await run(cwd, ["explain", ...args, "--format", "json"]);
    expect(e.code).toBe(0);
    expect(JSON.parse(e.stdout).activeConstraintCount).toBe(1);
    expect(e.stderr).toBe("");
    const snap = await run(cwd, [
      "snapshot",
      ...args,
      "--task",
      "Resume",
      "--include-content",
      "--output",
      "saved.json",
    ]);
    expect(snap.code).toBe(0);
    const saved = await readFile(join(cwd, "saved.json"), "utf8");
    expect(JSON.parse(saved).schemaVersion).toBe(3);
    const v = [
      "verify",
      ...args,
      "--handoff",
      "saved.json",
      "--require-content",
    ];
    expect((await run(cwd, [...v, "--format", "markdown"])).code).toBe(0);
    await writeFile(
      join(cwd, "constraints.json"),
      JSON.stringify(manifest([{ ...rule, description: "Updated" }])),
    );
    const fail = await run(cwd, [...v, "--format", "markdown"]);
    expect(fail.code).toBe(1);
    expect(fail.stdout).toContain("Before (saved)");
    expect(fail.stderr).toBe("");
    expect((await run(cwd, v)).stdout).toContain(
      'description: "Review migrations" -> "Updated"',
    );
    expect(await readFile(join(cwd, "saved.json"), "utf8")).toBe(saved);
    expect(
      (
        await run(cwd, [
          "snapshot",
          ...args,
          "--task",
          "Resume",
          "--include-content",
          "--output",
          "saved.json",
        ])
      ).code,
    ).toBe(2);
    for (const invalid of [
      ["verify", "--include-content"],
      ["explain", "--require-active"],
      ["explain", "--handoff", "saved.json"],
      ["explain", "--task", "x"],
      ["init", "--format", "markdown"],
      ["snapshot", "--task", "x", "--format", "markdown"],
    ])
      expect((await run(cwd, invalid)).code).toBe(2);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
