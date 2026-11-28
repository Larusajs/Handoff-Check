import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { evaluatePrepared, prepareCheck } from "../src/check-cli.js";
import { readBytes } from "../src/config.js";
import { reference } from "../src/content.js";
import { recordReview } from "../src/review.js";
import { readSourceTargets } from "../src/source-files.js";
import { parseManifest } from "../src/validation.js";
import { snapshot } from "../src/verifier.js";

const early = "2026-11-28T10:00:00.000Z",
  late = "2026-11-28T10:00:01.000Z";
const cli = resolve("dist/cli.js");
async function fixture(expiresAt?: string, reviewBy = "9999-12-31T23:59:59Z") {
  const cwd = await mkdtemp(join(tmpdir(), "handoff maintained "));
  const manifest = parseManifest({
    schemaVersion: 3,
    projectId: "demo",
    constraints: [
      {
        id: "C-1",
        revision: 1,
        scope: "global",
        description: "Review work",
        source: "policy.md",
        ...(expiresAt ? { expiresAt } : {}),
      },
    ],
  });
  const rule = manifest.constraints[0];
  if (!rule) throw Error("fixture rule");
  const files: Record<string, unknown> = {
    ".handoff-check.json": {
      schemaVersion: 2,
      projectId: "demo",
      profiles: { stage: { scope: "staging" } },
    },
    "constraints.json": manifest,
    "handoff.json": snapshot(manifest, "Resume", "staging", early),
    "review.json": recordReview(manifest, "staging", early, "team", reviewBy),
    "sources.json": {
      schemaVersion: 1,
      projectId: "demo",
      capturedAt: early,
      sources: [
        {
          ...reference(rule),
          path: "policy.md",
          fileHash: `sha256:${createHash("sha256").update("policy").digest("hex")}`,
        },
      ],
    },
  };
  for (const [name, value] of Object.entries(files))
    await writeFile(join(cwd, name), JSON.stringify(value));
  await writeFile(join(cwd, "policy.md"), "policy");
  return { cwd, files };
}
async function exists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
async function collect(p: ReturnType<typeof Bun.spawn>) {
  const [out, err, code] = await Promise.all([
    new Response(p.stdout as ReadableStream).text(),
    new Response(p.stderr as ReadableStream).text(),
    p.exited,
  ]);
  return { out, err, code };
}
async function invoke(
  cwd: string,
  args: string[],
  child = [
    "node",
    "-e",
    'require("node:fs").writeFileSync("child-marker","yes");process.stdout.write("CHILD")',
  ],
) {
  return collect(
    Bun.spawn(
      ["node", cli, "run", "--profile", "stage", ...args, "--", ...child],
      { cwd, stdout: "pipe", stderr: "pipe" },
    ),
  );
}
async function delayed(
  cwd: string,
  times: string[],
  delay: number,
  childDelay = 0,
) {
  const script = join(cwd, "controlled.ts");
  await writeFile(
    script,
    `import {runVerified} from ${JSON.stringify(resolve("src/run.ts"))};
 import {checkDependencies} from ${JSON.stringify(resolve("src/check-cli.ts"))};
 import {writeFileSync} from "node:fs";
 let index=0;const times=${JSON.stringify(times)};
 const result=await runVerified(${JSON.stringify(cwd)},{profile:"stage",registry:"review.json",sources:"sources.json"},["node","-e",${JSON.stringify(`setTimeout(()=>{require("node:fs").writeFileSync("child-marker","yes");process.stdout.write("CHILD")},${childDelay})`)}],{...checkDependencies,clock:()=>times[index++]??times[times.length-1],sources:async(root,targets)=>{writeFileSync(${JSON.stringify(join(cwd, "source-ready"))},"yes");await new Promise(r=>setTimeout(r,${delay}));return checkDependencies.sources(root,targets);}});
 process.exitCode=result;`,
  );
  return Bun.spawn([process.execPath, script], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
}

test("maintained run launches explicit argv, inherits child result and preserves all inputs", async () => {
  const f = await fixture();
  try {
    const before = await Promise.all(
      Object.keys(f.files).map((n) => readFile(join(f.cwd, n), "utf8")),
    );
    const args = ["--registry", "review.json", "--sources", "sources.json"];
    const result = await invoke(f.cwd, args, [
      "node",
      "-e",
      "process.stdout.write(JSON.stringify(process.argv.slice(1)));process.exit(42)",
      "--",
      "two words",
      "--registry",
      "$literal",
      ";no-shell",
    ]);
    expect(result.code).toBe(42);
    expect(JSON.parse(result.out)).toEqual([
      "two words",
      "--registry",
      "$literal",
      ";no-shell",
    ]);
    expect(result.err).toContain("RUN MAINTENANCE PASSED");
    expect(result.err).toContain("RUN EXIT: 42");
    expect(
      await Promise.all(
        Object.keys(f.files).map((n) => readFile(join(f.cwd, n), "utf8")),
      ),
    ).toEqual(before);
  } finally {
    await rm(f.cwd, { recursive: true, force: true });
  }
});
test("selected overdue/stale/changed/invalid maintenance blocks without stdout or child", async () => {
  for (const scenario of ["overdue", "stale", "changed", "invalid"]) {
    const f = await fixture();
    try {
      const review = JSON.parse(
        await readFile(join(f.cwd, "review.json"), "utf8"),
      );
      if (scenario === "overdue") {
        review.rules[0].reviewedAt = "2020-01-01T00:00:00Z";
        review.rules[0].reviewBy = "2021-01-01T00:00:00Z";
        await writeFile(join(f.cwd, "review.json"), JSON.stringify(review));
      }
      if (scenario === "stale") {
        review.rules[0].revision = 2;
        await writeFile(join(f.cwd, "review.json"), JSON.stringify(review));
      }
      if (scenario === "changed" || scenario === "invalid")
        await writeFile(join(f.cwd, "policy.md"), "edited");
      if (scenario === "invalid")
        await writeFile(join(f.cwd, "review.json"), "{}");
      const r = await invoke(f.cwd, [
        "--registry",
        "review.json",
        "--sources",
        "sources.json",
      ]);
      expect(r.code).toBe(scenario === "invalid" ? 2 : 1);
      expect(r.out).toBe("");
      expect(r.err).toContain("command not started");
      expect(await exists(join(f.cwd, "child-marker"))).toBe(false);
      if (scenario === "invalid") {
        expect(r.err).toContain("review: INVALID");
        expect(r.err).toContain("SOURCE_CHANGED");
      }
    } finally {
      await rm(f.cwd, { recursive: true, force: true });
    }
  }
});

test("each maintained option is independent and diagnostics cap hostile-sized identifiers", async () => {
  const f = await fixture();
  try {
    const healthyReview = await readFile(join(f.cwd, "review.json"), "utf8");
    await writeFile(join(f.cwd, "sources.json"), "{}");
    expect((await invoke(f.cwd, ["--registry", "review.json"])).code).toBe(0);
    await writeFile(
      join(f.cwd, "sources.json"),
      JSON.stringify(f.files["sources.json"]),
    );
    await writeFile(join(f.cwd, "review.json"), "{}");
    expect((await invoke(f.cwd, ["--sources", "sources.json"])).code).toBe(0);
    expect((await invoke(f.cwd, ["--registry", "absent"])).code).toBe(2);
    const registry = JSON.parse(healthyReview);
    registry.rules.push({ ...registry.rules[0], id: "X".repeat(5000) });
    await writeFile(join(f.cwd, "review.json"), JSON.stringify(registry));
    const bounded = await invoke(f.cwd, ["--registry", "review.json"]);
    expect(bounded.code).toBe(1);
    expect(bounded.err).toContain("UNKNOWN_RULE");
    expect(bounded.err.length).toBeLessThan(2000);
    expect(bounded.out).toBe("");
  } finally {
    await rm(f.cwd, { recursive: true, force: true });
  }
});
test("maintained final clock catches expiry and review deadline crossed during awaited source IO", async () => {
  for (const scenario of ["expiry", "review"]) {
    const f = await fixture(
      scenario === "expiry" ? late : undefined,
      scenario === "review" ? late : undefined,
    );
    try {
      const r = await collect(await delayed(f.cwd, [early, late], 20));
      expect(r.code).toBe(1);
      expect(r.out).toBe("");
      expect(r.err).toContain(
        scenario === "expiry" ? "EXPIRED" : "OVERDUE_REVIEW",
      );
      expect(r.err).toContain(late);
      expect(await exists(join(f.cwd, "child-marker"))).toBe(false);
    } finally {
      await rm(f.cwd, { recursive: true, force: true });
    }
  }
});
test("clock rollback needing an unobserved source is invalid closed without another read", async () => {
  const f = await fixture(late);
  try {
    let sourceCalls = 0;
    const prepared = await prepareCheck(
      f.cwd,
      { profile: "stage", format: "text", sources: "sources.json" },
      {
        read: (p) => readBytes(p, true),
        clock: () => late,
        sources: async (_root, targets) => {
          sourceCalls++;
          expect(targets).toEqual([]);
          return new Map();
        },
      },
    );
    const atSelection = evaluatePrepared(prepared, late);
    expect(atSelection.status).toBe("attention");
    const earlier = evaluatePrepared(prepared, early);
    expect(earlier.status).toBe("invalid");
    expect(earlier.checks.verification.status).toBe("passed");
    expect(earlier.checks.sources.status).toBe("invalid");
    expect(sourceCalls).toBe(1);
    const processResult = await collect(
      await delayed(f.cwd, [late, early], 20),
    );
    expect(processResult.code).toBe(2);
    expect(processResult.err).toContain("Missing source observation");
    expect(await exists(join(f.cwd, "child-marker"))).toBe(false);
  } finally {
    await rm(f.cwd, { recursive: true, force: true });
  }
});
test("preparation caches parsed metadata and synchronous reevaluation never rereads changed inputs", async () => {
  const f = await fixture();
  try {
    const reads = new Map<string, number>();
    let sourceCalls = 0;
    const prepared = await prepareCheck(
      f.cwd,
      {
        profile: "stage",
        format: "text",
        registry: "review.json",
        sources: "sources.json",
      },
      {
        read: async (p) => {
          reads.set(p, (reads.get(p) ?? 0) + 1);
          return readBytes(p, true);
        },
        clock: () => early,
        sources: async (root, targets) => {
          sourceCalls++;
          return readSourceTargets(root, targets);
        },
      },
    );
    await writeFile(join(f.cwd, "constraints.json"), "{}");
    await writeFile(join(f.cwd, "review.json"), "{}");
    await writeFile(join(f.cwd, "policy.md"), "changed");
    expect(evaluatePrepared(prepared, late).status).toBe("passed");
    expect(evaluatePrepared(prepared, early).status).toBe("passed");
    expect([...reads.values()]).toEqual([1, 1, 1, 1, 1]);
    expect(sourceCalls).toBe(1);
  } finally {
    await rm(f.cwd, { recursive: true, force: true });
  }
});
test("maintained wrapper rejects overrides while default run ignores broken unrequested metadata", async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.cwd, "review.json"), "{}");
    await writeFile(join(f.cwd, "sources.json"), "{}");
    const normal = await invoke(f.cwd, []);
    expect(normal.code).toBe(0);
    expect(normal.err).not.toContain("MAINTENANCE");
    expect(normal.out).toBe("CHILD");
    for (const extra of [
      ["--as-of", early],
      ["--format", "json"],
      ["--output", "x"],
      ["--report"],
      ["--require-active"],
      ["--bindings", "x"],
    ]) {
      const r = await invoke(f.cwd, ["--registry", "review.json", ...extra]);
      expect(r.code).toBe(2);
      expect(r.out).toBe("");
    }
  } finally {
    await rm(f.cwd, { recursive: true, force: true });
  }
});
test("watchdog covers delayed maintained source IO and never starts child", async () => {
  const f = await fixture();
  try {
    const r = await collect(await delayed(f.cwd, [early, early], 6000));
    expect(r.code).toBe(2);
    expect(r.err).toContain("preflight exceeded 5 seconds");
    expect(r.out).toBe("");
    expect(await exists(join(f.cwd, "child-marker"))).toBe(false);
  } finally {
    await rm(f.cwd, { recursive: true, force: true });
  }
}, 10000);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  test.skipIf(process.platform === "win32")(
    `${signal} cancels maintained source preparation without a child`,
    async () => {
      const f = await fixture();
      try {
        const p = await delayed(f.cwd, [early, early], 6000);
        const result = collect(p);
        for (
          let i = 0;
          i < 200 && !(await exists(join(f.cwd, "source-ready")));
          i++
        )
          await new Promise((r) => setTimeout(r, 10));
        expect(await exists(join(f.cwd, "source-ready"))).toBe(true);
        p.kill(signal);
        const r = await result;
        expect(r.code).toBe(signal === "SIGINT" ? 130 : 143);
        expect(r.err).toContain("RUN CANCELLED before command launch");
        expect(await exists(join(f.cwd, "child-marker"))).toBe(false);
      } finally {
        await rm(f.cwd, { recursive: true, force: true });
      }
    },
  );
test("maintained launch clears watchdog before a long-running child", async () => {
  const f = await fixture();
  try {
    const r = await collect(await delayed(f.cwd, [early, early], 0, 5200));
    expect(r.code).toBe(0);
    expect(r.out).toBe("CHILD");
    expect(r.err).not.toContain("exceeded");
    expect(await exists(join(f.cwd, "child-marker"))).toBe(true);
  } finally {
    await rm(f.cwd, { recursive: true, force: true });
  }
}, 10000);
