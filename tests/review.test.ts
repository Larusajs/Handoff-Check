import { expect, test } from "bun:test";
import {
  mkdir,
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
import { fullFormats } from "ajv-formats/dist/formats.js";
import registrySchema from "../schemas/review-registry.v1.schema.json" with {
  type: "json",
};
import resultSchema from "../schemas/review-result.v1.schema.json" with {
  type: "json",
};
import { reference } from "../src/content.js";
import { lifecycleHook } from "../src/lifecycle.js";
import {
  parseReviewRegistry,
  recordReview,
  reviewRules,
  reviewText,
} from "../src/review.js";
import { parseManifest } from "../src/validation.js";
import { snapshot, verify } from "../src/verifier.js";

const clock = "2026-11-26T08:00:00Z";
const deadline = "2026-11-27T08:00:00Z";
const global = {
  id: "A-global",
  scope: "global",
  revision: 1,
  description: "Review changes",
  source: "policy.md",
};
const stage = { ...global, id: "B-stage", scope: "staging" };
const prod = { ...global, id: "C-prod", scope: "production" };
const manifest = () =>
  parseManifest({
    schemaVersion: 3,
    projectId: "demo",
    constraints: [prod, stage, global],
  });
const registry = () =>
  recordReview(manifest(), "staging", clock, "platform-team", deadline);
const cli = resolve("dist/cli.js");
const ajv = new Ajv2020({ formats: fullFormats });
const validRegistry = ajv.compile(registrySchema);
const validResult = ajv.compile(resultSchema);

async function run(cwd: string, args: string[]) {
  const child = Bun.spawn(["node", cli, ...args], {
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { out, err, code };
}

test("review records explicit active references and agrees with published schemas", () => {
  const recorded = registry();
  expect(recorded.rules.map((r) => r.id)).toEqual([global.id, stage.id]);
  expect(recorded.rules[0]).toEqual({
    ...reference(global),
    owner: "platform-team",
    reviewedAt: "2026-11-26T08:00:00.000Z",
    reviewBy: "2026-11-27T08:00:00.000Z",
  });
  expect(validRegistry(recorded)).toBe(true);
  const result = reviewRules(manifest(), recorded, "staging", clock);
  expect(result.status).toBe("current");
  expect(result.activeConstraintCount).toBe(2);
  expect(result.currentReviewCount).toBe(2);
  expect(validResult(result)).toBe(true);
  expect(result.findings).toEqual([]);
});

test("review time boundaries are exact and future reviews do not count as current", () => {
  for (const [asOf, status] of [
    ["2026-11-26T07:59:59.999Z", "FUTURE_REVIEW"],
    [clock, "CURRENT"],
    ["2026-11-27T07:59:59.999Z", "CURRENT"],
    [deadline, "OVERDUE_REVIEW"],
    ["2026-11-27T08:00:00.001Z", "OVERDUE_REVIEW"],
  ] as const) {
    const result = reviewRules(
      manifest(),
      registry(),
      "staging",
      asOf as string,
    );
    expect(result.rules.map((r) => r.status)).toEqual([status, status]);
    expect(validResult(result)).toBe(true);
  }
});

test("missing and stale reviews preserve metadata without approving changed rules", () => {
  const saved = registry();
  const changed = manifest();
  const first = changed.constraints.find((r) => r.id === global.id);
  if (first) first.description = "Different requirement";
  saved.rules = saved.rules.filter((r) => r.id !== stage.id);
  const result = reviewRules(changed, saved, "staging", deadline);
  expect(result.rules.map((r) => r.status)).toEqual([
    "STALE_REVIEW",
    "MISSING_REVIEW",
  ]);
  expect(result.findings.map((f) => f.code)).toEqual([
    "STALE_REVIEW",
    "MISSING_REVIEW",
  ]);
  expect(result.rules[0]?.owner).toBe("platform-team");
  expect(result.rules[0]?.expected.contentHash).not.toBe(
    result.rules[0]?.recorded?.contentHash,
  );
  expect(validResult(result)).toBe(true);
  const future = reviewRules(
    changed,
    registry(),
    "staging",
    "2026-11-25T08:00:00Z",
  );
  expect(future.rules[0]?.status).toBe("STALE_REVIEW");
});

test("revision-only changes and regressions are stale independently of content hash", () => {
  for (const revision of [2, 3]) {
    const saved = registry();
    const current = manifest();
    const rule = current.constraints.find((r) => r.id === global.id);
    if (rule) rule.revision = revision;
    expect(reviewRules(current, saved, "staging", clock).rules[0]?.status).toBe(
      "STALE_REVIEW",
    );
    if (saved.rules[0]) saved.rules[0].revision = revision + 1;
    expect(reviewRules(current, saved, "staging", clock).rules[0]?.status).toBe(
      "STALE_REVIEW",
    );
  }
});

test("project-wide registry ignores known inactive rules but reports orphan IDs", () => {
  const saved = recordReview(
    manifest(),
    "production",
    clock,
    "production-team",
    deadline,
  );
  saved.rules.push({
    ...(saved.rules[0] as NonNullable<(typeof saved.rules)[0]>),
    id: "Z-orphan",
  });
  const result = reviewRules(manifest(), saved, "staging", clock);
  expect(result.ignoredEntryCount).toBe(1);
  expect(result.registryEntryCount).toBe(3);
  expect(result.findings).toEqual([
    { id: stage.id, code: "MISSING_REVIEW" },
    { id: "Z-orphan", code: "UNKNOWN_RULE" },
  ]);
  expect(result.currentReviewCount).toBe(1);
  expect(validResult(result)).toBe(true);
});

test("review selection follows expiry, revocation, supersession, scope and global lifecycle", () => {
  for (const extra of [
    { expiresAt: clock },
    { revokedAt: clock },
    { replacedBy: stage.id, supersededAt: clock },
  ]) {
    const input = parseManifest({
      schemaVersion: 2,
      constraints: [global, stage, { ...stage, id: "inactive", ...extra }],
    });
    const recorded = recordReview(input, "staging", clock, "team", deadline);
    expect(recorded.rules.map((r) => r.id)).toEqual([global.id, stage.id]);
    expect(
      reviewRules(input, recorded, "staging", clock).activeConstraintCount,
    ).toBe(2);
  }
  const empty = parseManifest({ schemaVersion: 2, constraints: [stage] });
  const result = reviewRules(
    empty,
    { schemaVersion: 1, rules: [] },
    "production",
    clock,
  );
  expect(result.status).toBe("attention");
  expect(result.findings).toEqual([{ code: "NO_ACTIVE_CONSTRAINTS" }]);
  expect(validResult(result)).toBe(true);
  expect(() =>
    recordReview(empty, "production", clock, "team", deadline),
  ).toThrow("at least one");
});

test("review never changes verification, hashes, handoff baselines or inputs", () => {
  const input = manifest();
  const saved = registry();
  const handoff = snapshot(input, "Work", "staging", clock);
  const before = JSON.stringify([input, saved, handoff]);
  const verified = verify(input, handoff, "staging", clock);
  expect(reviewRules(input, saved, "staging", deadline).status).toBe(
    "attention",
  );
  expect(verify(input, handoff, "staging", deadline).status).toBe("verified");
  expect(verified.expectedConstraints).toEqual([global.id, stage.id]);
  expect(JSON.stringify([input, saved, handoff])).toBe(before);
});

test("review project binding cannot be mixed or silently downgraded", () => {
  const unbound = parseManifest({
    schemaVersion: 1,
    constraints: [
      {
        id: global.id,
        scope: global.scope,
        description: global.description,
        source: global.source,
      },
    ],
  });
  expect(() =>
    reviewRules(manifest(), { schemaVersion: 1, rules: [] }, "staging", clock),
  ).toThrow("project binding");
  expect(() => reviewRules(unbound, registry(), "staging", clock)).toThrow(
    "project binding",
  );
  expect(() =>
    reviewRules(
      manifest(),
      { ...registry(), projectId: "other" },
      "staging",
      clock,
    ),
  ).toThrow("project binding");
  const record = recordReview(unbound, "staging", clock, "team", deadline);
  expect(record.projectId).toBeUndefined();
  expect(reviewRules(unbound, record, "staging", clock).status).toBe("current");
});

test("review registry parser rejects malformed contracts and semantic inconsistencies", () => {
  const base = registry();
  for (const input of [
    null,
    [],
    {},
    { ...base, schemaVersion: 2 },
    { ...base, projectId: null },
    { ...base, extra: true },
    { ...base, rules: null },
    { ...base, rules: [...base.rules, base.rules[0]] },
  ])
    expect(() => parseReviewRegistry(input)).toThrow();
  for (const fields of [
    { owner: " " },
    { owner: null },
    { reviewedAt: "2026-02-30T00:00:00Z" },
    { reviewBy: clock },
    { reviewBy: "2020-01-01T00:00:00Z" },
    { reviewedAt: "tomorrow" },
    { contentHash: `sha256:${"A".repeat(64)}` },
    { contentHash: `${base.rules[0]?.contentHash}\n` },
    { revision: 0 },
    { revision: 9007199254740992 },
    { extra: true },
    { id: "bad:id" },
  ])
    expect(() =>
      parseReviewRegistry({
        ...base,
        rules: [{ ...base.rules[0], ...fields }],
      }),
    ).toThrow();
  expect(
    validRegistry({ ...base, rules: [{ ...base.rules[0], owner: null }] }),
  ).toBe(false);
  expect(
    validRegistry({
      ...base,
      rules: [{ ...base.rules[0], reviewedAt: "2026-02-30T00:00:00Z" }],
    }),
  ).toBe(false);
  expect(() =>
    recordReview(manifest(), "staging", clock, "team", clock),
  ).toThrow("later");
});

test("review is stable under reordering and escapes hostile owner data", () => {
  const input = manifest();
  const saved = recordReview(
    input,
    "staging",
    clock,
    "<script>\n# [contact](https://evil.test)\u001b\u202e",
    deadline,
  );
  const result = reviewRules(input, saved, "staging", clock);
  input.constraints.reverse();
  saved.rules.reverse();
  expect(reviewRules(input, saved, "staging", clock)).toEqual(result);
  expect(reviewText(result, true)).not.toContain("<script>");
  expect(reviewText(result, true)).not.toContain("[contact]");
  expect(reviewText(result, false)).not.toContain("\u001b");
});

test("Node CLI records new files, reviews statuses and preserves config/manifest/handoff bytes", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "handoff review "));
  try {
    await writeFile(join(cwd, "constraints.json"), JSON.stringify(manifest()));
    await writeFile(
      join(cwd, ".handoff-check.json"),
      JSON.stringify({
        schemaVersion: 2,
        projectId: "demo",
        profiles: { stage: { scope: "staging", handoff: "MUST-NOT-READ" } },
      }),
    );
    const base = ["--profile", "stage", "--as-of", clock];
    const recordArgs = [
      "review-record",
      ...base,
      "--owner",
      "team",
      "--review-by",
      deadline,
      "--output",
      "reviews.json",
      "--format",
      "json",
    ];
    const recorded = await run(cwd, recordArgs);
    expect(recorded.code).toBe(0);
    expect(JSON.parse(recorded.out).entries).toBe(2);
    expect((await run(cwd, recordArgs)).code).toBe(2);
    const names = (await readdir(cwd)).sort();
    const before = await Promise.all(
      names.map((n) => readFile(join(cwd, n), "utf8")),
    );
    const result = await run(cwd, [
      "review",
      ...base,
      "--registry",
      "reviews.json",
      "--format",
      "json",
    ]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.out).currentReviewCount).toBe(2);
    expect(result.err).toBe("");
    const overdue = await run(cwd, [
      "review",
      "--profile",
      "stage",
      "--registry",
      "reviews.json",
      "--as-of",
      deadline,
      "--format",
      "markdown",
    ]);
    expect(overdue.code).toBe(1);
    expect(overdue.out).toContain("OVERDUE_REVIEW");
    expect(
      await Promise.all(names.map((n) => readFile(join(cwd, n), "utf8"))),
    ).toEqual(before);
    expect((await readdir(cwd)).sort()).toEqual(names);
    expect(
      (
        await run(cwd, [
          "review-record",
          ...base,
          "--owner",
          "team",
          "--review-by",
          deadline,
          "--output",
          "missing/record.json",
        ])
      ).code,
    ).toBe(2);
    await symlink(join(cwd, "reviews.json"), join(cwd, "link.json"));
    expect(
      (
        await run(cwd, [
          "review-record",
          ...base,
          "--owner",
          "team",
          "--review-by",
          deadline,
          "--output",
          "link.json",
        ])
      ).code,
    ).toBe(2);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("review CLI keeps config-relative manifest and cwd-relative registry without handoff reads", async () => {
  const root = await mkdtemp(join(tmpdir(), "handoff-review-paths-"));
  try {
    const project = join(root, "project");
    const caller = join(root, "caller");
    await mkdir(project);
    await mkdir(caller);
    await writeFile(
      join(project, "constraints.json"),
      JSON.stringify(manifest()),
    );
    await writeFile(
      join(project, ".handoff-check.json"),
      JSON.stringify({
        schemaVersion: 2,
        projectId: "demo",
        constraints: "constraints.json",
        profiles: { stage: { scope: "staging", handoff: "missing.json" } },
      }),
    );
    await writeFile(join(caller, "registry.json"), JSON.stringify(registry()));
    const result = await run(caller, [
      "review",
      "--config",
      "../project/.handoff-check.json",
      "--profile",
      "stage",
      "--registry",
      "registry.json",
      "--as-of",
      clock,
      "--format",
      "json",
    ]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.out).activeConstraintCount).toBe(2);
    const recorded = await run(caller, [
      "review-record",
      "--config",
      "../project/.handoff-check.json",
      "--profile",
      "stage",
      "--owner",
      "team",
      "--review-by",
      deadline,
      "--as-of",
      clock,
    ]);
    expect(recorded.code).toBe(0);
    expect(parseReviewRegistry(JSON.parse(recorded.out)).projectId).toBe(
      "demo",
    );
    for (const args of [
      ["review"],
      ["review", "--registry", "registry.json", "--handoff", "missing"],
      ["review-record", "--registry", "registry.json"],
      [
        "review-record",
        "--owner",
        "team",
        "--review-by",
        deadline,
        "--format",
        "markdown",
      ],
      [
        "review",
        "--profile",
        "stage",
        "--scope",
        "staging",
        "--registry",
        "registry.json",
      ],
      ["verify", "--registry", "registry.json"],
    ])
      expect((await run(caller, args)).code).toBe(2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("overdue or malformed review registries never implicitly gate verify, run or lifecycle", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "handoff-review-independent-"));
  try {
    const configPath = join(cwd, ".handoff-check.json");
    await writeFile(join(cwd, "constraints.json"), JSON.stringify(manifest()));
    await writeFile(
      configPath,
      JSON.stringify({
        schemaVersion: 2,
        projectId: "demo",
        profiles: { stage: { scope: "staging" } },
      }),
    );
    await writeFile(
      join(cwd, "handoff.json"),
      JSON.stringify(snapshot(manifest(), "Continue work", "staging", clock)),
    );
    await writeFile(
      join(cwd, "reviews.json"),
      JSON.stringify(
        recordReview(
          manifest(),
          "staging",
          "2020-01-01T00:00:00Z",
          "team",
          "2021-01-01T00:00:00Z",
        ),
      ),
    );
    const review = await run(cwd, [
      "review",
      "--profile",
      "stage",
      "--registry",
      "reviews.json",
      "--format",
      "json",
    ]);
    expect(review.code).toBe(1);
    expect(JSON.parse(review.out).rules[0].status).toBe("OVERDUE_REVIEW");
    for (const metadata of [
      await readFile(join(cwd, "reviews.json"), "utf8"),
      "not valid JSON",
    ]) {
      await writeFile(join(cwd, "reviews.json"), metadata);
      expect(
        (
          await run(cwd, [
            "verify",
            "--profile",
            "stage",
            "--require-content",
            "--require-active",
            "--format",
            "json",
          ])
        ).code,
      ).toBe(0);
      const child = await run(cwd, [
        "run",
        "--profile",
        "stage",
        "--",
        "node",
        "-e",
        'console.log("AUTHORIZED TEST PROGRAM")',
      ]);
      expect(child.code).toBe(0);
      expect(child.out).toBe("AUTHORIZED TEST PROGRAM\n");
      const hook = await lifecycleHook(
        { hook_event_name: "SessionStart", source: "resume", cwd },
        configPath,
        true,
        "stage",
      );
      expect(hook.hookSpecificOutput.additionalContext).toContain("PASS");
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("shipped maintenance example is schema-valid and scope-specific", async () => {
  const input = parseManifest(
    JSON.parse(
      await readFile("examples/rule-reviews/constraints.json", "utf8"),
    ),
  );
  const saved = parseReviewRegistry(
    JSON.parse(await readFile("examples/rule-reviews/reviews.json", "utf8")),
  );
  expect(validRegistry(saved)).toBe(true);
  expect(reviewRules(input, saved, "staging", clock).status).toBe("current");
  const production = reviewRules(input, saved, "production", clock);
  expect(production.findings).toEqual([{ code: "MISSING_REVIEW", id: "P-01" }]);
  expect(production.ignoredEntryCount).toBe(1);
});
