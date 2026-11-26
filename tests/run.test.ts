import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseManifest } from "../src/validation.js";
import { snapshot } from "../src/verifier.js";

const cli = resolve("dist/cli.js");
async function waitForText(stream: ReadableStream<Uint8Array>, text: string) {
  const reader = stream.getReader();
  let output = "";
  while (!output.includes(text)) {
    const chunk = await reader.read();
    if (chunk.done) throw new Error(`Process ended before ${text}: ${output}`);
    output += new TextDecoder().decode(chunk.value);
  }
  reader.releaseLock();
}
const rule = {
  id: "review",
  revision: 1,
  scope: "global",
  description: "Review changes",
  source: "policy.md",
};

async function fixture(bound = true) {
  const cwd = await mkdtemp(join(tmpdir(), "handoff run "));
  const manifest = {
    schemaVersion: bound ? 3 : 2,
    ...(bound ? { projectId: "demo" } : {}),
    constraints: [rule],
  };
  await writeFile(join(cwd, "constraints.json"), JSON.stringify(manifest));
  await writeFile(
    join(cwd, "handoff.json"),
    JSON.stringify(
      snapshot(
        parseManifest(manifest),
        "Review work",
        "production",
        "2020-01-01T00:00:00Z",
        { includeContent: bound },
      ),
    ),
  );
  await writeFile(
    join(cwd, ".handoff-check.json"),
    JSON.stringify({
      schemaVersion: 2,
      ...(bound ? { projectId: "demo" } : {}),
      profiles: { prod: { scope: "production" } },
    }),
  );
  return cwd;
}

async function run(
  cwd: string,
  options: string[] = [],
  child = [
    "node",
    "-e",
    'require("node:fs").writeFileSync("child-started", "yes");console.log("CHILD")',
  ],
  stdin?: string,
) {
  const process_ = Bun.spawn(["node", cli, "run", ...options, "--", ...child], {
    cwd,
    env: { ...process.env, HANDOFF_RUN_TEST: "inherited" },
    stdin: stdin === undefined ? "ignore" : "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (stdin !== undefined && process_.stdin) {
    process_.stdin.write(stdin);
    process_.stdin.end();
  }
  const [out, err, code] = await Promise.all([
    new Response(process_.stdout).text(),
    new Response(process_.stderr).text(),
    process_.exited,
  ]);
  return { out, err, code };
}

test("run verifies active bound profile, inherits streams/cwd/env and preserves every input", async () => {
  const cwd = await fixture();
  try {
    const names = await readdir(cwd);
    const before = await Promise.all(
      names.map((name) => readFile(join(cwd, name), "utf8")),
    );
    const result = await run(
      cwd,
      ["--profile", "prod"],
      [
        "node",
        "-e",
        'process.stdout.write(JSON.stringify({cwd:process.cwd(),env:process.env.HANDOFF_RUN_TEST,input:require("node:fs").readFileSync(0,"utf8")}));process.stderr.write("CHILD STDERR\\n")',
      ],
      "hello stdin",
    );
    expect(result.code).toBe(0);
    const output = JSON.parse(result.out);
    // Windows may report the same directory through its short-name alias.
    output.cwd = await realpath(output.cwd);
    expect(output).toEqual({
      cwd: await realpath(cwd),
      env: "inherited",
      input: "hello stdin",
    });
    expect(result.err).toContain("RUN VERIFIED: 1 active constraints");
    expect(result.err).toContain("project demo | profile prod");
    expect(result.err).toContain("CHILD STDERR");
    expect(result.err).toContain("RUN EXIT: 0");
    expect(
      await Promise.all(names.map((name) => readFile(join(cwd, name), "utf8"))),
    ).toEqual(before);
    expect(await readdir(cwd)).toEqual(names);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("run passes child arguments literally, including option names and shell metacharacters", async () => {
  const cwd = await fixture(false);
  try {
    const args = [
      "--help",
      "--version",
      "--profile",
      "--as-of",
      "--",
      "",
      "two words",
      "a;touch injected",
      "$(touch injected)",
      "`touch injected`",
      "$HOME",
      "*",
      'a"b',
      "Türkçe",
    ];
    const result = await run(
      cwd,
      ["--profile", "prod"],
      [
        "node",
        "-e",
        "console.log(JSON.stringify(process.argv.slice(1)))",
        "--",
        ...args,
      ],
    );
    expect(result.code).toBe(0);
    expect(JSON.parse(result.out)).toEqual(args);
    expect(await readdir(cwd)).not.toContain("injected");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("run propagates child exit codes without recategorizing child failures", async () => {
  const cwd = await fixture();
  try {
    for (const code of [0, 1, 2, 42, 127]) {
      const result = await run(
        cwd,
        ["--profile", "prod"],
        [
          "node",
          "-e",
          `process.stdout.write("child output");process.exit(${code})`,
        ],
      );
      expect(result.code).toBe(code);
      expect(result.out).toBe("child output");
      expect(result.err).toContain(`RUN EXIT: ${code}`);
      expect(result.err).not.toContain("BLOCKED");
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("run blocks missing, changed, expired and empty declarations without starting the child", async () => {
  for (const failure of ["missing", "changed", "expired", "empty"] as const) {
    const cwd = await fixture();
    try {
      const manifestPath = join(cwd, "constraints.json");
      const handoffPath = join(cwd, "handoff.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      const handoff = JSON.parse(await readFile(handoffPath, "utf8"));
      if (failure === "missing") handoff.activeConstraints = [];
      if (failure === "changed")
        manifest.constraints[0].description = "Different requirement";
      if (failure === "expired") {
        manifest.constraints[0].expiresAt = "2021-01-01T00:00:00Z";
        Object.assign(
          handoff,
          snapshot(
            parseManifest(manifest),
            "Old work",
            "production",
            "2020-01-01T00:00:00Z",
          ),
        );
      }
      if (failure === "empty") {
        manifest.constraints = [];
        handoff.activeConstraints = [];
      }
      await writeFile(manifestPath, JSON.stringify(manifest));
      await writeFile(handoffPath, JSON.stringify(handoff));
      const result = await run(cwd, ["--profile", "prod"]);
      expect(result.code).toBe(1);
      expect(result.out).toBe("");
      expect(result.err).toContain("RUN BLOCKED");
      expect(result.err).toContain(
        {
          missing: "MISSING",
          changed: "CHANGED",
          expired: "EXPIRED",
          empty: "NO_ACTIVE_CONSTRAINTS",
        }[failure],
      );
      expect(await readdir(cwd)).not.toContain("child-started");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  }
});

test("run rejects invalid input, foreign projects/scopes, legacy content and unknown profiles before spawn", async () => {
  for (const failure of [
    "invalid",
    "project",
    "scope",
    "legacy",
    "profile",
  ] as const) {
    const cwd = await fixture();
    try {
      const path = join(cwd, "handoff.json");
      const handoff = JSON.parse(await readFile(path, "utf8"));
      if (failure === "project") handoff.projectId = "other";
      if (failure === "scope") handoff.scope = "staging";
      await writeFile(
        path,
        failure === "invalid"
          ? "bad json"
          : JSON.stringify(
              failure === "legacy"
                ? {
                    schemaVersion: 1,
                    task: "Legacy",
                    activeConstraints: [rule.id],
                  }
                : handoff,
            ),
      );
      const result = await run(cwd, [
        "--profile",
        failure === "profile" ? "unknown" : "prod",
      ]);
      expect(result.code).toBe(2);
      expect(result.out).toBe("");
      expect(result.err).toContain("INVALID");
      expect(await readdir(cwd)).not.toContain("child-started");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  }
});

test("run rejects time/policy/format overrides and missing separator or command", async () => {
  const cwd = await fixture();
  try {
    for (const options of [
      ["--as-of", "2020-01-01T00:00:00Z"],
      ["--require-active"],
      ["--require-content"],
      ["--format", "text"],
      ["--report"],
      ["--output", "overwrite"],
      ["--profile", "prod", "--scope", "production"],
    ]) {
      expect((await run(cwd, options)).code).toBe(2);
    }
    expect((await run(cwd, ["--profile", "prod"], [])).code).toBe(2);
    expect((await run(cwd, ["--profile", "prod"], [" "])).code).toBe(2);
    const child = Bun.spawn(["node", cli, "run", "--profile", "prod", "node"], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await child.exited).toBe(2);
    expect(await readdir(cwd)).not.toContain("child-started");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("run reports a spawn error after verification without fabricating command success", async () => {
  const cwd = await fixture();
  try {
    const result = await run(
      cwd,
      ["--profile", "prod"],
      [join(cwd, "does-not-exist")],
    );
    expect(result.code).toBe(2);
    expect(result.out).toBe("");
    expect(result.err).toContain("RUN VERIFIED");
    expect(result.err).toContain("RUN LAUNCH ERROR: ENOENT");
    expect(result.err).not.toContain("RUN STARTED");
    expect(result.err).not.toContain("RUN EXIT: 0");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("run supports legacy manifests with content-aware handoffs and explicit CLI paths", async () => {
  const cwd = await fixture(false);
  try {
    await writeFile(
      join(cwd, "constraints.json"),
      JSON.stringify({
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
    );
    const result = await run(cwd, [
      "--scope",
      "production",
      "--constraints",
      "constraints.json",
      "--handoff",
      "handoff.json",
    ]);
    expect(result.code).toBe(0);
    expect(result.out).toBe("CHILD\n");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("run watchdog cancels a delayed asynchronous preflight without a child", async () => {
  const cwd = await fixture();
  const preload = join(cwd, "delayed-read.cjs");
  await writeFile(
    preload,
    'require("node:fs/promises").open=async()=>new Promise(()=>{});require("node:module").syncBuiltinESMExports();',
  );
  const child = Bun.spawn(
    [
      "node",
      "--require",
      preload,
      cli,
      "run",
      "--profile",
      "prod",
      "--",
      "node",
      "-e",
      'require("node:fs").writeFileSync("child-started","yes")',
    ],
    { cwd, stdout: "pipe", stderr: "pipe" },
  );
  try {
    expect(await child.exited).toBe(2);
    expect(await new Response(child.stderr).text()).toContain(
      "preflight exceeded 5 seconds; command not started",
    );
    expect(await new Response(child.stdout).text()).toBe("");
    expect(await readdir(cwd)).not.toContain("child-started");
  } finally {
    if (child.exitCode === null) child.kill("SIGKILL");
    await rm(cwd, { recursive: true, force: true });
  }
}, 8000);

test.skipIf(process.platform === "win32")(
  "run cancels delayed preflight immediately on SIGINT and SIGTERM",
  async () => {
    const cwd = await fixture();
    const preload = join(cwd, "delayed-read.cjs");
    await writeFile(
      preload,
      'require("node:fs/promises").open=async()=>{process.stderr.write("DELAYED READ\\n");return new Promise(()=>{})};require("node:module").syncBuiltinESMExports();',
    );
    try {
      for (const signal of ["SIGINT", "SIGTERM"] as const) {
        const child = Bun.spawn(
          [
            "node",
            "--require",
            preload,
            cli,
            "run",
            "--profile",
            "prod",
            "--",
            "node",
            "-e",
            'require("node:fs").writeFileSync("child-started","yes")',
          ],
          { cwd, stdout: "pipe", stderr: "pipe" },
        );
        try {
          await waitForText(child.stderr, "DELAYED READ");
          child.kill(signal);
          expect(await child.exited).toBe(signal === "SIGINT" ? 130 : 143);
          expect(await new Response(child.stdout).text()).toBe("");
          expect(await readdir(cwd)).not.toContain("child-started");
        } finally {
          if (child.exitCode === null) child.kill("SIGKILL");
        }
      }
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  },
);

test.skipIf(process.platform === "win32")(
  "run forwards SIGTERM to the direct child and preserves its handled exit",
  async () => {
    const cwd = await fixture();
    try {
      const child = Bun.spawn(
        [
          "node",
          cli,
          "run",
          "--profile",
          "prod",
          "--",
          "node",
          "-e",
          'process.on("SIGTERM",()=>process.exit(23));console.log("READY");setInterval(()=>{},1000)',
        ],
        { cwd, stdout: "pipe", stderr: "pipe" },
      );
      const reader = child.stdout.getReader();
      const ready = await reader.read();
      expect(new TextDecoder().decode(ready.value)).toContain("READY");
      child.kill("SIGTERM");
      expect(await child.exited).toBe(23);
      expect(await new Response(child.stderr).text()).toContain(
        "RUN SIGNAL SIGTERM",
      );
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  },
);

test.skipIf(process.platform === "win32")(
  "run rejects FIFO config and inputs before reading or starting a command",
  async () => {
    const cwd = await fixture();
    const fifo = join(cwd, "not-a-file");
    execFileSync("mkfifo", [fifo]);
    try {
      for (const option of ["--config", "--constraints", "--handoff"]) {
        const result = await run(cwd, [option, fifo, "--scope", "production"]);
        expect(result.code).toBe(2);
        expect(result.out).toBe("");
        expect(result.err).toContain("INVALID");
        expect(await readdir(cwd)).not.toContain("child-started");
      }
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  },
);

test.skipIf(process.platform === "win32")(
  "run maps an unhandled child signal to 128 plus the signal number",
  async () => {
    const cwd = await fixture();
    try {
      const result = await run(
        cwd,
        ["--profile", "prod"],
        ["node", "-e", 'process.kill(process.pid,"SIGTERM")'],
      );
      expect(result.code).toBe(143);
      expect(result.err).toContain("RUN EXIT: 143 | signal SIGTERM");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  },
);
