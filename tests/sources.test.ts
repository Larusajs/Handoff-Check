import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
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
import planSchema from "../schemas/source-bindings.v1.schema.json" with {
  type: "json",
};
import registrySchema from "../schemas/source-registry.v1.schema.json" with {
  type: "json",
};
import resultSchema from "../schemas/source-result.v1.schema.json" with {
  type: "json",
};
import { reference } from "../src/content.js";
import { lifecycleHook } from "../src/lifecycle.js";
import { recordReview, reviewRules } from "../src/review.js";
import {
  readSourceFile,
  readSourceTargets,
  sourceRoot,
} from "../src/source-files.js";
import {
  checkSources,
  parseSourcePlan,
  parseSourceRegistry,
  recordSourceTargets,
  type SourceRegistry,
  sourceCheckTargets,
  sourceLimit,
  sourcePath,
  sourceText,
} from "../src/sources.js";
import { parseManifest } from "../src/validation.js";
import { snapshot } from "../src/verifier.js";

const clock = "2026-11-27T08:00:00Z";
const rule = {
  id: "G-01",
  revision: 1,
  scope: "global",
  description: "Review policy",
  source: "https://invalid.example/policy",
};
const stage = { ...rule, id: "S-01", scope: "staging" };
const prod = { ...rule, id: "P-01", scope: "production" };
const manifest = () =>
  parseManifest({
    schemaVersion: 3,
    projectId: "demo",
    constraints: [prod, stage, rule],
  });
const plan = () =>
  parseSourcePlan({
    schemaVersion: 1,
    projectId: "demo",
    bindings: [
      { id: rule.id, path: "policy.bin" },
      { id: stage.id, path: "policy.bin" },
    ],
  });
const abc =
  "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
const registry = (): SourceRegistry =>
  parseSourceRegistry({
    schemaVersion: 1,
    projectId: "demo",
    capturedAt: clock,
    sources: recordSourceTargets(manifest(), plan(), "staging", clock).map(
      (r) => ({ ...r, fileHash: abc }),
    ),
  });
const cli = resolve("dist/cli.js");
const ajv = new Ajv2020({ formats: fullFormats });
const validPlan = ajv.compile(planSchema),
  validRegistry = ajv.compile(registrySchema),
  validResult = ajv.compile(resultSchema);
async function run(cwd: string, args: string[], preload?: string) {
  const child = Bun.spawn(
    ["node", ...(preload ? ["--require", preload] : []), cli, ...args],
    { cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe" },
  );
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { out, err, code };
}
async function fixture() {
  const cwd = await mkdtemp(join(tmpdir(), "handoff sources "));
  await writeFile(join(cwd, "constraints.json"), JSON.stringify(manifest()));
  await writeFile(join(cwd, "bindings.json"), JSON.stringify(plan()));
  await writeFile(join(cwd, "sources.json"), JSON.stringify(registry()));
  await writeFile(join(cwd, "policy.bin"), "abc");
  await writeFile(
    join(cwd, ".handoff-check.json"),
    JSON.stringify({
      schemaVersion: 2,
      projectId: "demo",
      profiles: { stage: { scope: "staging", handoff: "MUST-NOT-READ" } },
    }),
  );
  return cwd;
}

test("source contracts and independent result schemas accept explicit active bindings", () => {
  expect(validPlan(plan())).toBe(true);
  expect(validRegistry(registry())).toBe(true);
  const result = checkSources(
    manifest(),
    registry(),
    "staging",
    clock,
    new Map([["policy.bin", { status: "READ", fileHash: abc, bytes: 3 }]]),
  );
  expect(result.status).toBe("unchanged");
  expect(result.activeConstraintCount).toBe(2);
  expect(result.unchangedSourceCount).toBe(2);
  expect(validResult(result)).toBe(true);
  expect(result.rules.map((r) => r.id)).toEqual([rule.id, stage.id]);
});

test("source result distinguishes raw-byte changes and per-file failures", () => {
  for (const observation of [
    { status: "READ", fileHash: `sha256:${"0".repeat(64)}`, bytes: 5 },
    { status: "SOURCE_MISSING" },
    { status: "SOURCE_UNREADABLE" },
    { status: "SOURCE_UNSAFE" },
    { status: "SOURCE_TOO_LARGE" },
  ] as const) {
    const result = checkSources(
      manifest(),
      registry(),
      "staging",
      clock,
      new Map([["policy.bin", observation]]),
    );
    expect(result.status).toBe("attention");
    expect(result.rules[0]?.status).toBe(
      observation.status === "READ" ? "SOURCE_CHANGED" : observation.status,
    );
    expect(validResult(result)).toBe(true);
  }
  expect(() =>
    checkSources(manifest(), registry(), "staging", clock, new Map()),
  ).toThrow("Missing source observation");
});

test("missing/stale/ignored/orphan bindings never become source read targets", () => {
  const saved = registry();
  const current = manifest();
  const global = current.constraints.find((r) => r.id === rule.id);
  if (global) global.description = "Edited policy";
  saved.sources = saved.sources.filter((r) => r.id !== stage.id);
  saved.sources.push(
    { ...reference(prod), path: "never-read", fileHash: abc },
    { ...reference(rule), id: "Z-orphan", path: "never-read", fileHash: abc },
  );
  expect(sourceCheckTargets(current, saved, "staging", clock)).toEqual([]);
  const result = checkSources(current, saved, "staging", clock, new Map());
  expect(result.rules.map((r) => r.status)).toEqual([
    "STALE_BINDING",
    "MISSING_BINDING",
  ]);
  expect(result.ignoredEntryCount).toBe(1);
  expect(result.findings.map((f) => f.code)).toEqual([
    "STALE_BINDING",
    "MISSING_BINDING",
    "UNKNOWN_RULE",
  ]);
  expect(validResult(result)).toBe(true);
});

test("source record selection requires complete explicit active bindings and matching projects", () => {
  const targets = recordSourceTargets(manifest(), plan(), "staging", clock);
  expect(targets.map((r) => r.id)).toEqual([rule.id, stage.id]);
  expect(() =>
    recordSourceTargets(
      manifest(),
      { ...plan(), bindings: [] },
      "staging",
      clock,
    ),
  ).toThrow("Missing explicit");
  expect(() =>
    recordSourceTargets(
      manifest(),
      { ...plan(), bindings: [{ id: "unknown", path: "policy.bin" }] },
      "staging",
      clock,
    ),
  ).toThrow("does not exist");
  expect(() =>
    recordSourceTargets(
      manifest(),
      { ...plan(), projectId: "other" },
      "staging",
      clock,
    ),
  ).toThrow("project binding");
  expect(() =>
    sourceCheckTargets(
      manifest(),
      { schemaVersion: 1, capturedAt: clock, sources: [] },
      "staging",
      clock,
    ),
  ).toThrow("project binding");
  const unbound = parseManifest({
    schemaVersion: 1,
    constraints: [
      {
        id: rule.id,
        scope: rule.scope,
        description: rule.description,
        source: rule.source,
      },
    ],
  });
  expect(
    recordSourceTargets(
      unbound,
      { schemaVersion: 1, bindings: [{ id: rule.id, path: "policy.bin" }] },
      "staging",
      clock,
    )[0]?.revision,
  ).toBe(1);
  expect(() =>
    sourceCheckTargets(unbound, registry(), "staging", clock),
  ).toThrow("project binding");
});

test("source selection follows lifecycle and rejects empty capture without claiming an empty pass", () => {
  const input = parseManifest({
    schemaVersion: 3,
    projectId: "demo",
    constraints: [{ ...stage, expiresAt: clock }],
  });
  const result = checkSources(
    input,
    { schemaVersion: 1, projectId: "demo", capturedAt: clock, sources: [] },
    "staging",
    clock,
    new Map(),
  );
  expect(result.findings).toEqual([{ code: "NO_ACTIVE_CONSTRAINTS" }]);
  expect(result.status).toBe("attention");
  expect(validResult(result)).toBe(true);
  expect(() =>
    recordSourceTargets(
      input,
      { schemaVersion: 1, projectId: "demo", bindings: [] },
      "staging",
      clock,
    ),
  ).toThrow("at least one");
});

test("source path grammar rejects traversal, platform aliases, URLs and malformed Unicode", () => {
  for (const path of [
    "",
    ".",
    "..",
    "/etc/passwd",
    "../policy",
    "a/../b",
    "a/./b",
    "a//b",
    "a/",
    "C:/policy",
    "\\\\host\\share",
    "a\\b",
    "https://example.com",
    "file:policy",
    "CON",
    "aux.txt",
    "a.",
    "a ",
    "a\u0000b",
    "a\u202eb",
    "a\ud800b",
    "a*",
    "a?",
    "a".repeat(256),
  ])
    expect(() => sourcePath(path)).toThrow();
  for (const path of [
    "policy.md",
    "docs/two words.md",
    "Türkçe/🙂.txt",
    "docs/$(literal);file.md",
    ".policy",
  ])
    expect(sourcePath(path)).toBe(path);
});

test("source parsers reject malformed hashes, duplicates, unsafe revisions and excess entries", () => {
  for (const value of [
    null,
    [],
    {},
    { ...plan(), schemaVersion: 2 },
    { ...plan(), projectId: null },
    { ...plan(), unknown: true },
    { ...plan(), bindings: [...plan().bindings, plan().bindings[0]] },
    {
      ...plan(),
      bindings: Array.from({ length: 257 }, (_, i) => ({
        id: `C-${i}`,
        path: "policy.bin",
      })),
    },
  ])
    expect(() => parseSourcePlan(value)).toThrow();
  expect(
    parseSourcePlan({
      schemaVersion: 1,
      bindings: Array.from({ length: 256 }, (_, i) => ({
        id: `C-${i}`,
        path: "policy.bin",
      })),
    }).bindings,
  ).toHaveLength(256);
  for (const fields of [
    { revision: 0 },
    { revision: 9007199254740992 },
    { contentHash: "sha256:bad" },
    { fileHash: `${abc}\n` },
    { path: "../outside" },
    { extra: true },
  ])
    expect(() =>
      parseSourceRegistry({
        ...registry(),
        sources: [{ ...registry().sources[0], ...fields }],
      }),
    ).toThrow();
  expect(() =>
    parseSourceRegistry({ ...registry(), capturedAt: "2026-02-30T00:00:00Z" }),
  ).toThrow();
});

test("raw file hashes match independent Python vectors including binary, CRLF and BOM", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "handoff-source-bytes-"));
  const samples = [
    [
      Buffer.from(""),
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    ],
    [
      Buffer.from("abc"),
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    ],
    [
      Buffer.from("abc\n"),
      "edeaaff3f1774ad2888673770c6d64097e391bc362d7d6fb34982ddf0efd18cb",
    ],
    [
      Buffer.from("abc\r\n"),
      "552bab6864c7a7b69a502ed1854b9245c0e1a30f008aaa0b281da62585fdb025",
    ],
    [
      Buffer.from([0, 255, 254]),
      "d590f90f7944340fb253f0c59cb89fd41d4ec255ff246f524f8f7c94f0a233e5",
    ],
    [
      Buffer.from([239, 187, 191, 97, 98, 99]),
      "1c28dc3f1f804a1ad9c9b4b4cf5e2658d16ad4ed08e3020d04a8d2865018947c",
    ],
  ] as const;
  try {
    const root = await sourceRoot(cwd);
    for (const [bytes, hash] of samples) {
      await writeFile(join(cwd, "policy.bin"), bytes);
      expect(await readSourceFile(root, "policy.bin")).toEqual({
        status: "READ",
        fileHash: `sha256:${hash}`,
        bytes: bytes.length,
      });
    }
    expect(await readSourceFile(root, "missing")).toEqual({
      status: "SOURCE_MISSING",
    });
    await mkdir(join(cwd, "directory"));
    expect(await readSourceFile(root, "directory")).toEqual({
      status: "SOURCE_UNSAFE",
    });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("source reads enforce the inclusive 10 MiB limit", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "handoff-source-limit-"));
  try {
    const root = await sourceRoot(cwd);
    await writeFile(join(cwd, "policy.bin"), Buffer.alloc(sourceLimit));
    const accepted = await readSourceFile(root, "policy.bin");
    expect(accepted.status).toBe("READ");
    if (accepted.status === "READ") expect(accepted.bytes).toBe(sourceLimit);
    await writeFile(join(cwd, "policy.bin"), Buffer.alloc(sourceLimit + 1));
    expect(await readSourceFile(root, "policy.bin")).toEqual({
      status: "SOURCE_TOO_LARGE",
    });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("source reader rejects leaf and ancestor symlinks, including contained links", async () => {
  const cwd = await fixture();
  const outside = await mkdtemp(join(tmpdir(), "handoff-source-outside-"));
  try {
    await writeFile(join(outside, "secret"), "PRIVATE CONTENT MUST NOT APPEAR");
    await symlink(join(outside, "secret"), join(cwd, "leaf"));
    await symlink(
      outside,
      join(cwd, "parent"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await symlink(join(cwd, "policy.bin"), join(cwd, "inside-link"));
    const root = await sourceRoot(cwd);
    for (const path of ["leaf", "parent/secret", "inside-link"])
      expect(await readSourceFile(root, path)).toEqual({
        status: "SOURCE_UNSAFE",
      });
    expect(
      (
        await readSourceTargets(cwd, [
          { path: "policy.bin" },
          { path: "policy.bin" },
        ])
      ).size,
    ).toBe(1);
  } finally {
    await rm(cwd, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test.skipIf(process.platform === "win32")(
  "source FIFO is rejected promptly without opening it",
  async () => {
    const cwd = await fixture();
    try {
      execFileSync("mkfifo", [join(cwd, "pipe")]);
      expect(await readSourceFile(await sourceRoot(cwd), "pipe")).toEqual({
        status: "SOURCE_UNSAFE",
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  },
);

test("Node source commands preserve inputs, capture exclusive files and report changed bytes", async () => {
  const cwd = await fixture();
  try {
    const base = ["--profile", "stage", "--as-of", clock];
    const names = (await readdir(cwd)).sort();
    const before = await Promise.all(names.map((n) => readFile(join(cwd, n))));
    const checked = await run(cwd, [
      "source-check",
      ...base,
      "--sources",
      "sources.json",
      "--format",
      "json",
    ]);
    expect(checked.code).toBe(0);
    expect(JSON.parse(checked.out).unchangedSourceCount).toBe(2);
    const recorded = await run(cwd, [
      "source-record",
      ...base,
      "--bindings",
      "bindings.json",
      "--output",
      "new.json",
      "--format",
      "json",
    ]);
    expect(recorded.code).toBe(0);
    expect(JSON.parse(recorded.out).entries).toBe(2);
    expect(
      (
        await run(cwd, [
          "source-record",
          ...base,
          "--bindings",
          "bindings.json",
          "--output",
          "new.json",
        ])
      ).code,
    ).toBe(2);
    expect(await Promise.all(names.map((n) => readFile(join(cwd, n))))).toEqual(
      before,
    );
    await writeFile(join(cwd, "policy.bin"), "PRIVATE NEW CONTENT");
    const changed = await run(cwd, [
      "source-check",
      ...base,
      "--sources",
      "sources.json",
      "--format",
      "json",
    ]);
    expect(changed.code).toBe(1);
    expect(JSON.parse(changed.out).rules[0].status).toBe("SOURCE_CHANGED");
    expect(changed.out).not.toContain("PRIVATE NEW CONTENT");
    const current = manifest();
    const first = current.constraints.find((r) => r.id === rule.id);
    if (first) first.revision = 2;
    await writeFile(join(cwd, "constraints.json"), JSON.stringify(current));
    await rm(join(cwd, "policy.bin"));
    const stale = await run(cwd, [
      "source-check",
      ...base,
      "--sources",
      "sources.json",
      "--format",
      "json",
    ]);
    expect(stale.code).toBe(1);
    expect(
      JSON.parse(stale.out).rules.map((r: { status: string }) => r.status),
    ).toEqual(["STALE_BINDING", "SOURCE_MISSING"]);
    expect(
      (
        await run(cwd, [
          "source-record",
          ...base,
          "--bindings",
          "bindings.json",
          "--output",
          "failure.json",
        ])
      ).code,
    ).toBe(2);
    expect(await readdir(cwd)).not.toContain("failure.json");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("source CLI roots file bindings at config directory and never reads a handoff", async () => {
  const root = await mkdtemp(join(tmpdir(), "handoff-source-roots-"));
  try {
    const project = join(root, "project"),
      caller = join(root, "caller");
    await mkdir(project);
    await mkdir(caller);
    await writeFile(
      join(project, "constraints.json"),
      JSON.stringify(manifest()),
    );
    await writeFile(join(project, "policy.bin"), "abc");
    await writeFile(
      join(project, "config.json"),
      JSON.stringify({
        schemaVersion: 2,
        projectId: "demo",
        profiles: { stage: { scope: "staging", handoff: "missing.json" } },
      }),
    );
    await writeFile(join(caller, "sources.json"), JSON.stringify(registry()));
    const result = await run(caller, [
      "source-check",
      "--config",
      "../project/config.json",
      "--profile",
      "stage",
      "--sources",
      "sources.json",
      "--format",
      "json",
    ]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.out).activeConstraintCount).toBe(2);
    for (const args of [
      ["source-check"],
      ["source-record"],
      ["source-check", "--bindings", "plan.json"],
      ["source-record", "--sources", "sources.json"],
      ["verify", "--sources", "sources.json"],
      ["source-check", "--sources", "sources.json", "--handoff", "missing"],
      ["source-record", "--bindings", "plan.json", "--format", "markdown"],
    ])
      expect((await run(caller, args)).code).toBe(2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("overridden source reads are bounded during growth and shared paths are read once", async () => {
  const cwd = await fixture();
  try {
    const preload = join(cwd, "probe.cjs");
    await writeFile(
      preload,
      'const fs=require("node:fs"),p=require("node:fs/promises"),open=p.open;p.open=async function(path,...args){const h=await open.call(this,path,...args);if(String(path).endsWith("policy.bin"))fs.appendFileSync("opens","1");return h};require("node:module").syncBuiltinESMExports();',
    );
    const unchanged = await run(
      cwd,
      [
        "source-check",
        "--profile",
        "stage",
        "--sources",
        "sources.json",
        "--format",
        "json",
      ],
      preload,
    );
    expect(unchanged.code).toBe(0);
    expect(await readFile(join(cwd, "opens"), "utf8")).toBe("1");
    await writeFile(
      preload,
      'const p=require("node:fs/promises"),open=p.open;p.open=async function(path,...args){const h=await open.call(this,path,...args);if(String(path).endsWith("policy.bin")){let total=0;h.read=async(buffer,offset,length)=>{const bytesRead=Math.min(length,10485761-total);buffer.fill(0,offset,offset+bytesRead);total+=bytesRead;return {bytesRead,buffer}}}return h};require("node:module").syncBuiltinESMExports();',
    );
    const growing = await run(
      cwd,
      [
        "source-check",
        "--profile",
        "stage",
        "--sources",
        "sources.json",
        "--format",
        "json",
      ],
      preload,
    );
    expect(growing.code).toBe(1);
    expect(JSON.parse(growing.out).rules[0].status).toBe("SOURCE_TOO_LARGE");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("source registries do not implicitly gate verify/run/review/lifecycle or refresh baselines", async () => {
  const cwd = await fixture();
  try {
    const config = join(cwd, ".handoff-check.json");
    await writeFile(
      config,
      JSON.stringify({
        schemaVersion: 2,
        projectId: "demo",
        profiles: { stage: { scope: "staging" } },
      }),
    );
    const baseline = JSON.stringify(
      snapshot(manifest(), "Resume work", "staging", clock),
    );
    await writeFile(join(cwd, "handoff.json"), baseline);
    await writeFile(
      join(cwd, "reviews.json"),
      JSON.stringify(
        recordReview(
          manifest(),
          "staging",
          clock,
          "team",
          "2030-01-01T00:00:00Z",
        ),
      ),
    );
    await writeFile(join(cwd, "sources.json"), "bad JSON");
    await rm(join(cwd, "policy.bin"));
    expect(
      (
        await run(cwd, [
          "verify",
          "--profile",
          "stage",
          "--require-content",
          "--require-active",
        ])
      ).code,
    ).toBe(0);
    expect(
      (
        await run(cwd, [
          "run",
          "--profile",
          "stage",
          "--",
          "node",
          "-e",
          'console.log("TEST")',
        ])
      ).code,
    ).toBe(0);
    expect(
      (
        await run(cwd, [
          "review",
          "--profile",
          "stage",
          "--registry",
          "reviews.json",
          "--as-of",
          clock,
        ])
      ).code,
    ).toBe(0);
    expect(
      reviewRules(
        manifest(),
        recordReview(
          manifest(),
          "staging",
          clock,
          "team",
          "2030-01-01T00:00:00Z",
        ),
        "staging",
        clock,
      ).status,
    ).toBe("current");
    const hook = await lifecycleHook(
      { hook_event_name: "SessionStart", source: "resume", cwd },
      config,
      true,
      "stage",
    );
    expect(hook.hookSpecificOutput.additionalContext).toContain("PASS");
    expect(await readFile(join(cwd, "handoff.json"), "utf8")).toBe(baseline);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("source renderer is deterministic, escapes data and never claims semantic review", () => {
  const saved = registry();
  const input = manifest();
  saved.sources[0] = {
    ...(saved.sources[0] as NonNullable<(typeof saved.sources)[0]>),
    path: "docs/[link](literal).txt",
  };
  const observed = new Map<string, { status: "SOURCE_MISSING" }>([
    ["docs/[link](literal).txt", { status: "SOURCE_MISSING" }],
    ["policy.bin", { status: "SOURCE_MISSING" }],
  ]);
  const result = checkSources(input, saved, "staging", clock, observed);
  input.constraints.reverse();
  saved.sources.reverse();
  expect(checkSources(input, saved, "staging", clock, observed)).toEqual(
    result,
  );
  expect(sourceText(result, true)).not.toContain("[link]");
  expect(sourceText(result, false)).toContain("not semantic policy validation");
});

test("source IO failures remain per-file attention without leaking operating-system errors", async () => {
  const cwd = await fixture();
  try {
    const preload = join(cwd, "failure.cjs");
    await writeFile(
      preload,
      'const p=require("node:fs/promises"),open=p.open;p.open=async function(path,...args){if(String(path).endsWith("policy.bin"))throw Object.assign(new Error("PRIVATE ERROR"),{code:"EACCES"});return open.call(this,path,...args)};require("node:module").syncBuiltinESMExports();',
    );
    const denied = await run(
      cwd,
      [
        "source-check",
        "--profile",
        "stage",
        "--sources",
        "sources.json",
        "--format",
        "json",
      ],
      preload,
    );
    expect(denied.code).toBe(1);
    expect(JSON.parse(denied.out).rules[0].status).toBe("SOURCE_UNREADABLE");
    expect(denied.out + denied.err).not.toContain("PRIVATE ERROR");
    await writeFile(
      preload,
      'const p=require("node:fs/promises"),open=p.open;p.open=async function(path,...args){const h=await open.call(this,path,...args);if(String(path).endsWith("policy.bin")){const close=h.close.bind(h);h.close=async()=>{await close();throw Object.assign(new Error("PRIVATE CLOSE"),{code:"EIO"})}}return h};require("node:module").syncBuiltinESMExports();',
    );
    const closed = await run(
      cwd,
      [
        "source-check",
        "--profile",
        "stage",
        "--sources",
        "sources.json",
        "--format",
        "json",
      ],
      preload,
    );
    expect(closed.code).toBe(1);
    expect(JSON.parse(closed.out).rules[0].status).toBe("SOURCE_UNREADABLE");
    expect(closed.out + closed.err).not.toContain("PRIVATE CLOSE");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("shipped source fixture checks unchanged without reading a handoff", async () => {
  const result = await run(process.cwd(), [
    "source-check",
    "--config",
    "examples/local-sources/config.json",
    "--profile",
    "stage",
    "--sources",
    "examples/local-sources/sources.json",
    "--as-of",
    clock,
    "--format",
    "json",
  ]);
  expect(result.code).toBe(0);
  expect(JSON.parse(result.out).unchangedSourceCount).toBe(2);
  expect(validResult(JSON.parse(result.out))).toBe(true);
});
