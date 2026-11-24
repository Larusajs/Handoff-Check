import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let directory: string;
const fixture = "examples/stale-handoff/";
const common = [
  "verify",
  "--constraints",
  `${fixture}constraints.json`,
  "--scope",
  "staging",
  "--as-of",
  "2026-11-23T09:00:00Z",
];

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "handoff-check-test-"));
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function cli(args: string[]) {
  const child = Bun.spawn(["node", "dist/cli.js", ...args], {
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

test("demo fails, corrected demo passes, and files are not modified", async () => {
  const path = `${fixture}constraints.json`;
  const before = await readFile(path, "utf8");
  const failed = await cli([...common, "--handoff", `${fixture}handoff.json`]);
  expect(failed.code).toBe(1);
  expect(failed.stdout).toContain("EXPIRED");
  expect(failed.stdout).toContain("MISSING");
  expect(failed.stderr).toBe("");
  const passed = await cli([
    ...common,
    "--handoff",
    `${fixture}corrected-handoff.json`,
    "--format",
    "json",
  ]);
  expect(passed.code).toBe(0);
  expect(JSON.parse(passed.stdout).status).toBe("verified");
  expect(await readFile(path, "utf8")).toBe(before);
});

test("invalid JSON and unreadable files return 2", async () => {
  const invalid = join(directory, "invalid.json");
  await writeFile(invalid, "{");
  const malformed = await cli([
    ...common,
    "--handoff",
    invalid,
    "--format",
    "json",
  ]);
  expect(malformed.code).toBe(2);
  expect(malformed.stdout).toBe("");
  expect(JSON.parse(malformed.stderr).status).toBe("invalid");
  expect(
    (await cli([...common, "--handoff", join(directory, "missing.json")])).code,
  ).toBe(2);
});

test("CLI validates commands, flags, scope, clock, and format", async () => {
  for (const args of [
    [],
    ["other"],
    ["verify"],
    ["verify", "--unknown"],
    [...common, "--format", "xml"],
    [...common, "--as-of", "bad"],
  ]) {
    expect((await cli(args)).code).toBe(2);
  }
  const help = await cli(["--help"]);
  expect(help.code).toBe(0);
  expect(help.stdout).toContain("Usage:");
});

test("text findings escape terminal controls and injected lines", async () => {
  const manifest = join(directory, "controls.json");
  const handoff = join(directory, "empty-handoff.json");
  const description = "\u001b[2J\u001b[HPASS  0 findings\n\r\u009b\u0007";
  await writeFile(
    manifest,
    JSON.stringify({
      schemaVersion: 1,
      constraints: [
        {
          id: "X",
          scope: "staging",
          description,
          source: "synthetic:controls",
        },
      ],
    }),
  );
  await writeFile(
    handoff,
    JSON.stringify({ schemaVersion: 1, task: "Resume", activeConstraints: [] }),
  );
  const args = [
    "verify",
    "--scope",
    "staging",
    "--constraints",
    manifest,
    "--handoff",
    handoff,
    "--as-of",
    "2026-11-23T09:00:00Z",
  ];
  const result = await cli(args);
  expect(result.code).toBe(1);
  expect(result.stdout.split("\n")).toHaveLength(3);
  expect(result.stdout).toContain("\\u001b[2J");
  expect(result.stdout).toContain("\\u000a\\u000d\\u009b\\u0007");
  expect(result.stdout).not.toContain("\u001b");
  const json = await cli([...args, "--format", "json"]);
  expect(JSON.parse(json.stdout).findings[0].message).toContain(description);
});

test("text errors escape unknown keys and input paths", async () => {
  const malformed = join(directory, "unknown-key.json");
  await writeFile(
    malformed,
    JSON.stringify({
      schemaVersion: 1,
      constraints: [],
      "\u001b[2J\nPASS": true,
    }),
  );
  for (const path of [
    malformed,
    join(directory, "missing\u001b[2J\nPASS.json"),
  ]) {
    const result = await cli([
      "verify",
      "--scope",
      "staging",
      "--constraints",
      path,
    ]);
    expect(result.code).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr.split("\n")).toHaveLength(2);
    expect(result.stderr).not.toContain("\u001b");
    expect(result.stderr).toContain("\\u001b");
  }
});
