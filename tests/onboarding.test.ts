import { afterAll, expect, test } from "bun:test";
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

const binary = resolve("dist/cli.js");
const directories: string[] = [];
async function project() {
  const path = await mkdtemp(join(tmpdir(), "handoff-onboarding-"));
  directories.push(path);
  return path;
}
afterAll(async () => {
  await Promise.all(
    directories.map((path) => rm(path, { recursive: true, force: true })),
  );
});
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
  return { code, stdout, stderr };
}

test.each(["codex", "claude", "both", "none"])(
  "init installs selected agent %s and config is usable",
  async (agent) => {
    const cwd = await project();
    const result = await run(cwd, [
      "init",
      "--scope",
      "staging",
      "--agent",
      agent,
      "--format",
      "json",
    ]);
    expect(result.code).toBe(0);
    const initialized = JSON.parse(result.stdout);
    expect(initialized.status).toBe("initialized");
    expect(initialized.notice).toContain("zero rules");
    expect(
      initialized.files.some(
        (file: { path: string }) => file.path === "AGENTS.md",
      ),
    ).toBe(agent === "codex" || agent === "both");
    expect(
      initialized.files.some(
        (file: { path: string }) => file.path === "CLAUDE.md",
      ),
    ).toBe(agent === "claude" || agent === "both");
    const verified = await run(cwd, ["verify", "--format", "json"]);
    expect(verified.code).toBe(0);
    expect(JSON.parse(verified.stdout).scope).toBe("staging");
    const repeated = await run(cwd, [
      "init",
      "--agent",
      agent,
      "--format",
      "json",
    ]);
    expect(repeated.code).toBe(0);
    expect(
      JSON.parse(repeated.stdout).files.every(
        (file: { action: string }) => file.action === "preserve",
      ),
    ).toBe(true);
  },
);

test("dry run previews the actual instruction changes and writes nothing", async () => {
  const cwd = await project();
  const preview = await run(cwd, [
    "init",
    "--scope",
    "production",
    "--ci",
    "--dry-run",
    "--format",
    "json",
  ]);
  expect(preview.code).toBe(0);
  const data = JSON.parse(preview.stdout);
  expect(data.status).toBe("preview");
  expect(
    data.files.find((file: { path: string }) => file.path === "AGENTS.md")
      .content,
  ).toContain("npx --yes handoff-check@0.1.0");
  expect(await readdir(cwd)).toEqual([]);
});

test("init preserves existing rules and surrounding instruction text", async () => {
  const cwd = await project();
  const rules =
    '{"schemaVersion":1,"constraints":[{"id":"C-01","scope":"global","description":"Reviewed rule","source":"decision:1"}]}';
  const instructions = "# Team instructions\r\nPreserve this text exactly.";
  await writeFile(join(cwd, "constraints.json"), rules);
  await writeFile(join(cwd, "AGENTS.md"), instructions);
  expect((await run(cwd, ["init", "--scope", "staging"])).code).toBe(0);
  expect(await readFile(join(cwd, "constraints.json"), "utf8")).toBe(rules);
  const after = await readFile(join(cwd, "AGENTS.md"), "utf8");
  expect(after.startsWith(instructions)).toBe(true);
  expect((await run(cwd, ["init"])).code).toBe(0);
  expect(await readFile(join(cwd, "AGENTS.md"), "utf8")).toBe(after);
  expect((await run(cwd, ["init", "--scope", "production"])).code).toBe(2);
});

test("late skill and malformed managed-block conflicts cause no initial writes", async () => {
  for (const conflicting of ["skill", "markers"]) {
    const cwd = await project();
    if (conflicting === "skill") {
      await mkdir(join(cwd, ".claude/skills/handoff-check"), {
        recursive: true,
      });
      await writeFile(
        join(cwd, ".claude/skills/handoff-check/SKILL.md"),
        "Custom skill",
      );
    } else
      await writeFile(
        join(cwd, "CLAUDE.md"),
        "<!-- handoff-check:begin -->\nUser content",
      );
    const before = await readdir(cwd);
    for (const dryRun of [false, true]) {
      const result = await run(cwd, [
        "init",
        "--scope",
        "staging",
        ...(dryRun ? ["--dry-run"] : []),
      ]);
      expect(result.code).toBe(2);
      expect(await readdir(cwd)).toEqual(before);
    }
  }
});

test("init refuses symlink ancestors without changing outside files", async () => {
  const cwd = await project();
  const outside = await project();
  await symlink(outside, join(cwd, ".agents"), "junction");
  const result = await run(cwd, ["init", "--scope", "staging"]);
  expect(result.code).toBe(2);
  expect(result.stderr).toContain("symlink");
  expect(await readdir(outside)).toEqual([]);
  expect(await readdir(cwd)).toEqual([".agents"]);
});

test("config paths resolve against config directory while CLI paths use cwd", async () => {
  const cwd = await project();
  await mkdir(join(cwd, "nested"));
  await writeFile(
    join(cwd, "nested/config.json"),
    JSON.stringify({
      schemaVersion: 1,
      constraints: "rules.json",
      handoff: "handoff.json",
      scope: "staging",
    }),
  );
  await writeFile(
    join(cwd, "nested/rules.json"),
    JSON.stringify({ schemaVersion: 1, constraints: [] }),
  );
  await writeFile(
    join(cwd, "nested/handoff.json"),
    JSON.stringify({ schemaVersion: 1, task: "Resume", activeConstraints: [] }),
  );
  await writeFile(
    join(cwd, "override.json"),
    JSON.stringify({
      schemaVersion: 1,
      task: "Resume",
      activeConstraints: ["UNKNOWN"],
    }),
  );
  const base = ["verify", "--config", "nested/config.json", "--format", "json"];
  expect((await run(cwd, base)).code).toBe(0);
  const overridden = await run(cwd, [
    ...base,
    "--handoff",
    "override.json",
    "--scope",
    "production",
  ]);
  expect(overridden.code).toBe(1);
  expect(JSON.parse(overridden.stdout).scope).toBe("production");
  expect((await run(cwd, [...base, "--handoff", ""])).code).toBe(2);
});

test("init honors safe custom paths and rejects invalid config and path overlap", async () => {
  const cwd = await project();
  await writeFile(
    join(cwd, ".handoff-check.json"),
    JSON.stringify({
      schemaVersion: 1,
      constraints: "inputs/rules.json",
      handoff: "inputs/handoff.json",
      scope: "staging",
    }),
  );
  expect((await run(cwd, ["init", "--agent", "none"])).code).toBe(0);
  expect((await run(cwd, ["verify"])).code).toBe(0);
  for (const config of [
    { schemaVersion: 2 },
    { schemaVersion: 1, scope: "staging", typo: true },
    { schemaVersion: 1, scope: "staging", constraints: "../outside.json" },
    { schemaVersion: 1, scope: "staging", constraints: ".handoff-check.json" },
  ]) {
    const target = await project();
    await writeFile(
      join(target, ".handoff-check.json"),
      JSON.stringify(config),
    );
    expect((await run(target, ["init"])).code).toBe(2);
    expect(await readdir(target)).toEqual([".handoff-check.json"]);
  }
});

test("scope and command-specific options are explicit", async () => {
  const cwd = await project();
  for (const args of [
    ["init"],
    ["init", "--scope", ""],
    ["init", "--scope", "staging", "--agent", "other"],
    ["init", "--scope", "staging", "--handoff", "other.json"],
    ["verify", "--dry-run"],
    ["verify", "--config", "absent.json"],
  ])
    expect((await run(cwd, args)).code).toBe(2);
  expect(await readdir(cwd)).toEqual([]);
  expect((await run(cwd, ["--version"])).stdout.trim()).toBe("0.1.0");
});

test("ancestor and case-alias overlaps reject both preview and apply before writes", async () => {
  for (const paths of [
    { constraints: "inputs", handoff: "inputs/handoff.json" },
    { constraints: "inputs/rules.json", handoff: "inputs" },
    { constraints: ".agents", handoff: "handoff.json" },
    { constraints: ".github", handoff: "handoff.json" },
    { constraints: "RULES.json", handoff: "rules.json" },
  ]) {
    const cwd = await project();
    const config = JSON.stringify({
      schemaVersion: 1,
      scope: "staging",
      ...paths,
    });
    await writeFile(join(cwd, ".handoff-check.json"), config);
    for (const preview of [true, false]) {
      const result = await run(cwd, [
        "init",
        "--ci",
        ...(preview ? ["--dry-run"] : []),
      ]);
      expect(result.code).toBe(2);
      expect(await readdir(cwd)).toEqual([".handoff-check.json"]);
      expect(await readFile(join(cwd, ".handoff-check.json"), "utf8")).toBe(
        config,
      );
    }
  }
});
