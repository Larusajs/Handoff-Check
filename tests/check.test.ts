import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { fullFormats } from "ajv-formats/dist/formats.js";
import schema from "../schemas/check.v1.schema.json" with { type: "json" };
import { combinedText } from "../src/check.js";
import { combinedCheck } from "../src/check-cli.js";
import { readBytes } from "../src/config.js";
import { reference } from "../src/content.js";
import { recordReview } from "../src/review.js";
import { readSourceTargets } from "../src/source-files.js";
import { parseManifest } from "../src/validation.js";
import { snapshot } from "../src/verifier.js";

const time = "2026-11-28T10:00:00.000Z";
const cli = resolve("dist/cli.js");
const ajv = new Ajv2020();
ajv.addFormat("date-time", fullFormats["date-time"]);
const valid = ajv.compile(schema);
async function fixture() {
  const cwd = await mkdtemp(join(tmpdir(), "handoff combined "));
  const manifest = parseManifest({
    schemaVersion: 3,
    projectId: "demo",
    constraints: [
      {
        id: "C-1",
        revision: 1,
        scope: "global",
        description: "Review changes",
        source: "policy.md",
      },
    ],
  });
  const first = manifest.constraints[0];
  if (!first) throw new Error("fixture requires a rule");
  const files: Record<string, unknown> = {
    ".handoff-check.json": {
      schemaVersion: 2,
      projectId: "demo",
      profiles: { stage: { scope: "staging" } },
    },
    "constraints.json": manifest,
    "handoff.json": snapshot(manifest, "Resume", "staging", time),
    "review.json": recordReview(
      manifest,
      "staging",
      time,
      "team",
      "2027-01-01T00:00:00Z",
    ),
    "sources.json": {
      schemaVersion: 1,
      projectId: "demo",
      capturedAt: time,
      sources: [
        {
          ...reference(first),
          path: "policy.md",
          fileHash:
            "sha256:8f434346648f6b96df89dda901c5176b10a6d83961dd3c1ac88b59b2dc327aa4",
        },
      ],
    },
  };
  for (const [name, value] of Object.entries(files))
    await writeFile(join(cwd, name), JSON.stringify(value));
  await writeFile(join(cwd, "policy.md"), "hi");
  return { cwd, manifest, files };
}
const options = { profile: "stage", format: "json", "as-of": time };
async function invoke(cwd: string, args: string[]) {
  const p = Bun.spawn(["node", cli, "check", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  return { out, err, code };
}

test("combined check reports skipped optional checks and all-selected success without changing inputs", async () => {
  const f = await fixture();
  try {
    const before = await Promise.all(
      Object.keys(f.files).map((n) => readFile(join(f.cwd, n), "utf8")),
    );
    const skipped = (await combinedCheck(f.cwd, options)).report;
    expect(skipped.status).toBe("passed");
    expect(skipped.checks.review).toEqual({ status: "not-requested" });
    expect(skipped.summary).toEqual({
      requestedChecks: 1,
      passedChecks: 1,
      attentionChecks: 0,
      invalidChecks: 0,
      notRequestedChecks: 2,
    });
    const full = (
      await combinedCheck(f.cwd, {
        ...options,
        registry: "review.json",
        sources: "sources.json",
      })
    ).report;
    expect(full.summary).toEqual({
      requestedChecks: 3,
      passedChecks: 3,
      attentionChecks: 0,
      invalidChecks: 0,
      notRequestedChecks: 0,
    });
    expect(valid(full)).toBe(true);
    const mutate = (change: (report: typeof full) => void) => {
      const copy = structuredClone(full);
      change(copy);
      expect(valid(copy)).toBe(false);
    };
    mutate((r) => {
      if ("result" in r.checks.verification)
        Object.assign(r.checks.verification.result, { extra: true });
    });
    mutate((r) => {
      if ("result" in r.checks.verification)
        r.checks.verification.result.schemaVersion = 1;
    });
    mutate((r) => {
      if ("result" in r.checks.verification)
        Object.assign(r.checks.verification.result, { findings: [{}] });
    });
    mutate((r) => {
      if ("result" in r.checks.verification)
        r.checks.verification.result.status = "mismatch";
    });
    mutate((r) => {
      if ("result" in r.checks.review)
        r.checks.review.result.status = "attention";
    });
    mutate((r) => {
      if ("result" in r.checks.sources)
        r.checks.sources.result.status = "attention";
    });
    expect(
      await Promise.all(
        Object.keys(f.files).map((n) => readFile(join(f.cwd, n), "utf8")),
      ),
    ).toEqual(before);
    expect(valid({ ...full, extra: true })).toBe(false);
    expect(
      valid({
        ...full,
        checks: {
          ...full.checks,
          review: { status: "not-requested", result: {} },
        },
      }),
    ).toBe(false);
  } finally {
    await rm(f.cwd, { recursive: true, force: true });
  }
});

test("selected invalid wins over attention and preserves independent valid sections", async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.cwd, "policy.md"), "changed");
    await writeFile(join(f.cwd, "review.json"), "broken");
    const r = (
      await combinedCheck(f.cwd, {
        ...options,
        registry: "review.json",
        sources: "sources.json",
      })
    ).report;
    expect(r.status).toBe("invalid");
    expect(r.checks.verification.status).toBe("passed");
    expect(r.checks.review.status).toBe("invalid");
    expect(r.checks.sources.status).toBe("attention");
    expect(r.summary).toEqual({
      requestedChecks: 3,
      passedChecks: 1,
      attentionChecks: 1,
      invalidChecks: 1,
      notRequestedChecks: 0,
    });
    expect(valid(r)).toBe(true);
    await writeFile(
      join(f.cwd, "handoff.json"),
      JSON.stringify({
        schemaVersion: 1,
        task: "legacy",
        activeConstraints: ["C-1"],
      }),
    );
    await writeFile(join(f.cwd, "policy.md"), "hi");
    const independent = (
      await combinedCheck(f.cwd, { ...options, sources: "sources.json" })
    ).report;
    expect(independent.checks.verification.status).toBe("invalid");
    expect(independent.checks.sources.status).toBe("passed");
  } finally {
    await rm(f.cwd, { recursive: true, force: true });
  }
});

test("metadata pathname cache includes config and failed aliases while role parsing stays independent", async () => {
  const f = await fixture();
  try {
    const reads = new Map<string, number>();
    let clocks = 0;
    const deps = {
      read: async (path: string) => {
        reads.set(path, (reads.get(path) ?? 0) + 1);
        return readBytes(path, true);
      },
      clock: () => {
        clocks++;
        expect(reads.has(join(f.cwd, "review.json"))).toBe(true);
        return time;
      },
      sources: readSourceTargets,
    };
    const r = (
      await combinedCheck(
        f.cwd,
        {
          profile: "stage",
          format: "json",
          registry: "review.json",
          sources: "./review.json",
        },
        deps,
      )
    ).report;
    expect(r.checks.review.status).toBe("passed");
    expect(r.checks.sources.status).toBe("invalid");
    expect(reads.get(join(f.cwd, "review.json"))).toBe(1);
    expect(clocks).toBe(1);
    reads.clear();
    const aliased = (
      await combinedCheck(
        f.cwd,
        {
          scope: "staging",
          format: "json",
          "as-of": time,
          registry: ".handoff-check.json",
          sources: "missing.json",
          handoff: "./missing.json",
        },
        deps,
      )
    ).report;
    expect(aliased.summary.invalidChecks).toBe(3);
    expect([...reads.values()].every((n) => n === 1)).toBe(true);
  } finally {
    await rm(f.cwd, { recursive: true, force: true });
  }
});

test("all sections share one normalized lifecycle boundary and zero active is attention", async () => {
  const f = await fixture();
  try {
    const manifest = {
      ...f.manifest,
      constraints: f.manifest.constraints.map((r) => ({
        ...r,
        expiresAt: time,
      })),
    };
    await writeFile(join(f.cwd, "constraints.json"), JSON.stringify(manifest));
    const r = (
      await combinedCheck(f.cwd, {
        ...options,
        "as-of": "2026-11-28T10:00:00Z",
        registry: "review.json",
        sources: "sources.json",
      })
    ).report;
    expect(r.asOf).toBe(time);
    expect(r.activeConstraintCount).toBe(0);
    expect(r.status).toBe("attention");
    expect(r.summary.attentionChecks).toBe(3);
    for (const section of Object.values(r.checks))
      if ("result" in section) expect(section.result.asOf).toBe(time);
  } finally {
    await rm(f.cwd, { recursive: true, force: true });
  }
});

test("source selection ignores stale inactive orphan and missing targets before IO", async () => {
  const f = await fixture();
  try {
    const source = f.files["sources.json"] as {
      sources: {
        id: string;
        revision: number;
        contentHash: string;
        path: string;
        fileHash: string;
      }[];
    };
    const first = source.sources[0];
    if (!first) throw new Error("fixture requires a source");
    first.revision = 2;
    source.sources.push({
      ...first,
      id: "orphan",
      path: "never-read",
    });
    await writeFile(join(f.cwd, "sources.json"), JSON.stringify(source));
    let targets: unknown;
    const r = (
      await combinedCheck(
        f.cwd,
        { ...options, sources: "sources.json" },
        {
          read: (p) => readBytes(p, true),
          clock: () => time,
          sources: async (_root, t) => {
            targets = t;
            return new Map();
          },
        },
      )
    ).report;
    expect(targets).toEqual([]);
    expect(r.checks.sources.status).toBe("attention");
    expect(combinedText(r, false)).toContain("STALE_BINDING");
  } finally {
    await rm(f.cwd, { recursive: true, force: true });
  }
});

test("CLI separates common errors from section invalid reports and rejects policy/child flags", async () => {
  const f = await fixture();
  try {
    const base = ["--profile", "stage", "--as-of", time, "--format", "json"];
    const ok = await invoke(f.cwd, base);
    expect(ok.code).toBe(0);
    expect(ok.err).toBe("");
    const invalid = await invoke(f.cwd, [...base, "--registry", "absent"]);
    expect(invalid.code).toBe(2);
    expect(invalid.err).toBe("");
    expect(JSON.parse(invalid.out).checks.verification.status).toBe("passed");
    for (const args of [
      ["--output", "x"],
      ["--require-active"],
      ["--require-content"],
      ["--report"],
      ["--bindings", "x"],
      ["--", "node"],
      ["--scope", "staging"],
      ["--as-of", "bad"],
    ]) {
      const result = await invoke(f.cwd, [...base, ...args]);
      expect(result.code).toBe(2);
      expect(result.out).toBe("");
      expect(result.err).not.toBe("");
    }
    const unknown = await invoke(f.cwd, [
      "--profile",
      "missing",
      "--format",
      "json",
    ]);
    expect(unknown.out).toBe("");
    expect(unknown.code).toBe(2);
    await writeFile(join(f.cwd, "constraints.json"), "{}");
    const common = await invoke(f.cwd, base);
    expect(common.out).toBe("");
    expect(common.code).toBe(2);
  } finally {
    await rm(f.cwd, { recursive: true, force: true });
  }
});

test("mixed role binding is section invalid and hostile diagnostics/rendered data stay bounded and escaped", async () => {
  const f = await fixture();
  try {
    const registry = f.files["review.json"] as {
      projectId: string;
      rules: { owner: string }[];
    };
    registry.projectId = "foreign";
    await writeFile(join(f.cwd, "review.json"), JSON.stringify(registry));
    const mixed = (
      await combinedCheck(f.cwd, { ...options, registry: "review.json" })
    ).report;
    expect(mixed.checks.review.status).toBe("invalid");
    await writeFile(
      join(f.cwd, "review.json"),
      JSON.stringify({ [`\u001b[31m\n# forged ${"x".repeat(1000)}`]: true }),
    );
    const r = (
      await combinedCheck(f.cwd, { ...options, registry: "review.json" })
    ).report;
    if (r.checks.review.status !== "invalid") throw Error("expected invalid");
    expect(r.checks.review.error.length).toBeLessThanOrEqual(512);
    expect(combinedText(r, false)).not.toContain("\u001b");
    expect(combinedText(r, true)).not.toContain("\n# forged");
    expect(combinedText(r, true)).toContain("NOT-REQUESTED");
  } finally {
    await rm(f.cwd, { recursive: true, force: true });
  }
});
