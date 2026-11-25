import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { fullFormats } from "ajv-formats/dist/formats.js";
import configSchema from "../schemas/config.v2.schema.json" with {
  type: "json",
};
import manifestSchema from "../schemas/constraints.v3.schema.json" with {
  type: "json",
};
import handoffSchema from "../schemas/handoff.v4.schema.json" with {
  type: "json",
};
import reportSchema from "../schemas/report.v1.schema.json" with {
  type: "json",
};
import {
  loadConfig,
  parseConfig,
  readJsonRecord,
  selectProfile,
} from "../src/config.js";
import { reference } from "../src/content.js";
import { doctor } from "../src/doctor.js";
import { hookConfig, lifecycleHook } from "../src/lifecycle.js";
import { verificationReport } from "../src/report.js";
import { parseHandoff, parseManifest } from "../src/validation.js";
import { snapshot, verify } from "../src/verifier.js";

const clock = "2026-11-25T08:00:00Z";
const rule = {
  id: "C-01",
  revision: 1,
  scope: "staging",
  description: "Review migrations",
  source: "synthetic:policy",
};
const bound = () =>
  parseManifest({
    schemaVersion: 3,
    projectId: "sample-project",
    constraints: [rule],
  });
const ajv = new Ajv2020();
ajv.addFormat("date-time", fullFormats["date-time"]);
const validManifest = ajv.compile(manifestSchema),
  validHandoff = ajv.compile(handoffSchema),
  validConfig = ajv.compile(configSchema),
  validReport = ajv.compile(reportSchema);

test("binding matrix rejects mixed or cross-project inputs without changing old formats", () => {
  const manifests = [
    parseManifest({
      schemaVersion: 1,
      constraints: [
        {
          id: rule.id,
          scope: rule.scope,
          description: rule.description,
          source: rule.source,
        },
      ],
    }),
    parseManifest({ schemaVersion: 2, constraints: [rule] }),
    bound(),
  ];
  const old = manifests[1];
  if (!old) throw new Error("fixture");
  const handoffs = [
    parseHandoff({
      schemaVersion: 1,
      task: "Resume",
      activeConstraints: [rule.id],
    }),
    snapshot(old, "Resume", "staging", clock),
    snapshot(old, "Resume", "staging", clock, { includeContent: true }),
    snapshot(bound(), "Resume", "staging", clock),
  ];
  for (const m of manifests)
    for (const h of handoffs)
      for (const projectId of [
        undefined,
        "sample-project",
        "another-project",
      ]) {
        const accepts =
          (m.schemaVersion === 3 &&
            h.schemaVersion === 4 &&
            (projectId === undefined || projectId === "sample-project")) ||
          (m.schemaVersion !== 3 &&
            h.schemaVersion !== 4 &&
            projectId === undefined);
        if (accepts) {
          const result = verify(
            m,
            h,
            "staging",
            clock,
            projectId === undefined
              ? {}
              : projectId === undefined
                ? {}
                : { projectId },
          );
          expect(result.status).toBe("verified");
          expect(result.schemaVersion).toBe(h.schemaVersion);
          if (h.schemaVersion !== 4)
            expect(result).not.toHaveProperty("projectId");
        } else
          expect(() =>
            verify(
              m,
              h,
              "staging",
              clock,
              projectId === undefined ? {} : { projectId },
            ),
          ).toThrow();
      }
  const saved = snapshot(bound(), "Resume", "staging", clock);
  expect(() =>
    verify(
      bound(),
      parseHandoff({ ...saved, projectId: "another-project" }),
      "staging",
      clock,
    ),
  ).toThrow("bound to project");
  expect(() => verify(bound(), saved, "production", clock)).toThrow("scope");
  expect(() =>
    snapshot(old, "Resume", "staging", clock, { projectId: "sample-project" }),
  ).toThrow("requires");
  expect(reference(bound().constraints[0] ?? rule)).toEqual(reference(rule));
});

test("new schemas and runtime enforce binding and complete content modes", () => {
  expect(validManifest(bound())).toBe(true);
  for (const mode of [false, true]) {
    const h = snapshot(bound(), "Resume", "staging", clock, {
      includeContent: mode,
    });
    expect(validHandoff(h)).toBe(true);
    expect(parseHandoff(h)).toEqual(h);
  }
  const hashes = snapshot(bound(), "Resume", "staging", clock),
    retained = snapshot(bound(), "Resume", "staging", clock, {
      includeContent: true,
    });
  for (const bad of [
    { ...hashes, projectId: "bad id" },
    { ...hashes, contentMode: "unknown" },
    { ...hashes, contentMode: "retained" },
    { ...retained, contentMode: "hashes" },
    { ...hashes, projectId: null },
  ]) {
    expect(validHandoff(bad)).toBe(false);
    expect(() => parseHandoff(bad)).toThrow();
  }
  for (const bad of [
    { schemaVersion: 3, constraints: [rule] },
    {
      schemaVersion: 3,
      projectId: "x",
      constraints: [{ ...rule, revision: 0 }],
    },
  ]) {
    expect(validManifest(bad)).toBe(false);
    expect(() => parseManifest(bad)).toThrow();
  }
  const current = parseManifest({
    schemaVersion: 3,
    projectId: "sample-project",
    constraints: [{ ...rule, description: "Two reviews" }],
  });
  expect(verify(current, retained, "staging", clock).findings[0]).toMatchObject(
    {
      code: "CHANGED",
      changes: [
        {
          field: "description",
          before: rule.description,
          after: "Two reviews",
        },
      ],
    },
  );
});

const config = {
  schemaVersion: 2,
  projectId: "sample-project",
  constraints: "inputs/constraints.json",
  handoff: "inputs/staging.json",
  profiles: {
    stage: { scope: "staging" },
    prod: { scope: "production", handoff: "inputs/prod.json" },
  },
};
test("profiles are explicit and strict with top-level path fallback and own-key selection", () => {
  expect(validConfig(config)).toBe(true);
  const c = parseConfig(config);
  expect(selectProfile(c, "prod")).toMatchObject({
    scope: "production",
    constraints: "inputs/constraints.json",
    handoff: "inputs/prod.json",
  });
  expect(selectProfile(c)).not.toHaveProperty("scope");
  for (const name of ["missing", "toString", "__proto__"])
    expect(() => selectProfile(c, name)).toThrow();
  expect(() =>
    selectProfile(parseConfig({ schemaVersion: 1 }), "stage"),
  ).toThrow();
  for (const bad of [
    { ...config, profiles: {} },
    { ...config, profiles: { bad: { constraints: "x" } } },
    { ...config, profiles: { "bad name": { scope: "staging" } } },
    { ...config, profiles: { stage: { scope: "staging", projectId: "x" } } },
    { schemaVersion: 1, projectId: "x" },
  ]) {
    expect(validConfig(bad)).toBe(false);
    expect(() => parseConfig(bad)).toThrow();
  }
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "handoff06 ' project-"));
  await mkdir(join(root, "inputs"));
  await writeFile(join(root, ".handoff-check.json"), JSON.stringify(config));
  await writeFile(
    join(root, "inputs/constraints.json"),
    JSON.stringify(bound()),
  );
  await writeFile(
    join(root, "inputs/staging.json"),
    JSON.stringify(snapshot(bound(), "Resume", "staging", clock)),
  );
  await writeFile(
    join(root, "inputs/prod.json"),
    JSON.stringify(snapshot(bound(), "Resume", "production", clock)),
  );
  return realpath(root);
}
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

test("report identities describe the exact bytes parsed, with no metadata re-read", async () => {
  const root = await fixture();
  try {
    const path = join(root, "inputs/constraints.json");
    const bytes = await readFile(path);
    const record = await readJsonRecord(path);
    await writeFile(path, "changed after reading");
    const m = parseManifest(record.input);
    const h = snapshot(m, "Resume", "staging", clock);
    const result = verify(m, h, "staging", clock);
    const report = verificationReport(
      result,
      {
        manifest: { path: record.path, sha256: record.sha256 },
        handoff: { path: "saved", sha256: record.sha256 },
        config: null,
      },
      { requireContent: true, requireActive: false },
    );
    expect(record.sha256).toBe(
      `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    );
    expect(validReport(report)).toBe(true);
    expect(report.result.status).toBe("verified");
    expect(report.inputs.config).toBeNull();
    expect((await loadConfig(root)).source?.sha256).toBe(
      `sha256:${createHash("sha256")
        .update(await readFile(join(root, ".handoff-check.json")))
        .digest("hex")}`,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Node profiles drive verify, snapshot, explain, doctor and lifecycle consistently", async () => {
  const root = await fixture();
  try {
    const before = await readFile(join(root, "inputs/staging.json"), "utf8");
    const args = [
      "verify",
      "--profile",
      "stage",
      "--require-content",
      "--report",
      "--format",
      "json",
      "--as-of",
      clock,
    ];
    const r = await run(root, args);
    expect(r.code).toBe(0);
    const report = JSON.parse(r.stdout);
    expect(validReport(report)).toBe(true);
    expect(report.profile).toBe("stage");
    expect(report.result.projectId).toBe("sample-project");
    expect(report.inputs.manifest.path).toBe(
      join(root, "inputs/constraints.json"),
    );
    expect(report).not.toHaveProperty("git");
    expect((await run(root, ["verify"])).code).toBe(2);
    for (const flag of ["--scope", "--constraints", "--handoff"])
      expect(
        (await run(root, ["verify", "--profile", "stage", flag, "staging"]))
          .code,
      ).toBe(2);
    expect((await run(root, ["verify", "--profile", "missing"])).code).toBe(2);
    expect((await run(root, ["doctor", "--profile", "missing"])).code).toBe(2);
    const d = await run(root, [
      "doctor",
      "--profile",
      "stage",
      "--format",
      "json",
    ]);
    expect(d.code).toBe(0);
    expect(JSON.parse(d.stdout).projectId).toBe("sample-project");
    const explain = await run(root, [
      "explain",
      "--profile",
      "stage",
      "--format",
      "json",
      "--as-of",
      clock,
    ]);
    expect(explain.code).toBe(0);
    expect(JSON.parse(explain.stdout).activeConstraintCount).toBe(1);
    const snap = await run(root, [
      "snapshot",
      "--profile",
      "stage",
      "--task",
      "Review",
      "--include-content",
    ]);
    expect(snap.code).toBe(0);
    expect(JSON.parse(snap.stdout)).toMatchObject({
      schemaVersion: 4,
      contentMode: "retained",
      projectId: "sample-project",
    });
    const context = await lifecycleHook(
      { hook_event_name: "SessionStart", source: "resume", cwd: root },
      join(root, ".handoff-check.json"),
      false,
      "stage",
    );
    expect(context.hookSpecificOutput.additionalContext).toContain(
      "Project sample-project. Profile stage.",
    );
    expect(
      hookConfig(
        "claude",
        false,
        "stage",
      ).hooks.SessionStart[0]?.hooks[0]?.args.slice(-2),
    ).toEqual(["--profile", "stage"]);
    await writeFile(
      join(root, "inputs/staging.json"),
      JSON.stringify({ ...JSON.parse(before), projectId: "another-project" }),
    );
    expect((await run(root, args)).code).toBe(2);
    expect(
      (
        await lifecycleHook(
          { hook_event_name: "SessionStart", source: "startup", cwd: root },
          join(root, ".handoff-check.json"),
          false,
          "stage",
        )
      ).hookSpecificOutput.additionalContext,
    ).toContain("NOT VERIFIED");
    expect(
      (await doctor(root, { profile: "stage" })).diagnostics.some(
        (d) => d.code === "PROJECT_BINDING" && d.level === "error",
      ),
    ).toBe(true);
    expect(await readFile(join(root, "inputs/constraints.json"), "utf8")).toBe(
      JSON.stringify(bound()),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("optional reports preserve legacy nested shape, absent config and Git opt-in boundaries", async () => {
  const root = await mkdtemp(join(tmpdir(), "handoff06-report-"));
  try {
    await writeFile(
      join(root, "constraints.json"),
      JSON.stringify({ schemaVersion: 1, constraints: [] }),
    );
    await writeFile(
      join(root, "handoff.json"),
      JSON.stringify({
        schemaVersion: 1,
        task: "Resume",
        activeConstraints: [],
      }),
    );
    const args = [
      "verify",
      "--scope",
      "staging",
      "--as-of",
      clock,
      "--format",
      "json",
    ];
    const plain = JSON.parse((await run(root, args)).stdout);
    const report = JSON.parse((await run(root, [...args, "--report"])).stdout);
    expect(report.result).toEqual(plain);
    expect(report.inputs.config).toBeNull();
    expect(Object.keys(plain)).toEqual([
      "schemaVersion",
      "status",
      "scope",
      "asOf",
      "expectedConstraints",
      "reportedConstraints",
      "findings",
    ]);
    expect((await run(root, [...args, "--git-context"])).code).toBe(2);
    const noGit = await run(root, [...args, "--report", "--git-context"]);
    expect(noGit.code).toBe(2);
    expect(noGit.stdout).toBe("");
    const git = (...a: string[]) =>
      execFileSync("git", ["--no-optional-locks", "-C", root, ...a], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    git("init");
    expect((await run(root, [...args, "--report", "--git-context"])).code).toBe(
      2,
    );
    git(
      "-c",
      "user.name=Handoff Test",
      "-c",
      "user.email=test@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--allow-empty",
      "-m",
      "Synthetic fixture",
    );
    const withGit = JSON.parse(
      (await run(root, [...args, "--report", "--git-context"])).stdout,
    );
    expect(withGit.git.commit).toBe(git("rev-parse", "HEAD").trim());
    expect(validReport(withGit)).toBe(true);
    git("checkout", "--detach", "HEAD");
    expect(
      JSON.parse(
        (await run(root, [...args, "--report", "--git-context"])).stdout,
      ).git.branch,
    ).toBeNull();
    for (const bad of [
      ["verify", "--report"],
      ["explain", "--report"],
      ["snapshot", "--git-context"],
      ["init", "--profile", "stage"],
    ])
      expect((await run(root, bad)).code).toBe(2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
