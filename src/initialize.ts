import { constants } from "node:fs";
import { lstat, mkdir, open, readFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import metadata from "../package.json" with { type: "json" };
import { parseConfig, readJson } from "./config.js";
import {
  InputError,
  identifier,
  parseHandoff,
  parseManifest,
} from "./validation.js";

interface PlannedFile {
  path: string;
  action: "create" | "append" | "preserve";
  content: string;
  before?: string;
}
const begin = "<!-- handoff-check:begin -->";
const end = "<!-- handoff-check:end -->";
const instruction = `${begin}
Before resuming a handoff or continuing after a context reset, use the handoff-check
skill and run the configured verifier from this repository root:

\`\`\`sh
npx --yes handoff-check@${metadata.version} verify --format json --require-content
\`\`\`

Use .handoff-check.json for paths and scope. If no scope is configured, request the
intended scope and pass --scope explicitly. Use the current clock for real work.
Resolve exit 1 mismatches or exit 2 input errors before resuming the affected task.
Do not change the manifest merely to obtain a pass. Empty rules verify no policy;
author and review real project constraints before relying on this check. A pass
checks declared IDs only and does not grant authorization or interpret summaries.
Capture a snapshot only at handoff creation or after explicitly reviewing changes;
never refresh the baseline before verifying it when resuming work.
${end}
`;

async function inspect(
  root: string,
  path: string,
): Promise<string | undefined> {
  const rel = relative(root, path);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
    throw new InputError(
      `Initialization target must be inside the project: '${path}'`,
    );
  let current = root;
  const parts = rel.split(sep);
  for (const [index, part] of parts.entries()) {
    current = resolve(current, part);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink())
        throw new InputError(
          `Refusing symlink initialization target: '${current}'`,
        );
      if (index < parts.length - 1 && !info.isDirectory())
        throw new InputError(`Expected a directory: '${current}'`);
      if (index === parts.length - 1 && !info.isFile())
        throw new InputError(`Expected a regular file: '${current}'`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }
  return readFile(path, "utf8");
}

export async function initialize(
  root: string,
  options: { scope?: string; agent: string; dryRun: boolean; ci: boolean },
) {
  if (!["codex", "claude", "both", "none"].includes(options.agent))
    throw new InputError("--agent: expected codex, claude, both, or none");
  const plan: PlannedFile[] = [];
  const configPath = resolve(root, ".handoff-check.json");
  const previous = await inspect(root, configPath);
  const config =
    previous === undefined
      ? { schemaVersion: 1 as const }
      : parseConfig(await readJson(configPath));
  const scope = identifier(
    options.scope ?? config.scope,
    "init --scope (or config.scope)",
  );
  if (
    config.scope !== undefined &&
    options.scope !== undefined &&
    config.scope !== scope
  )
    throw new InputError(
      "Existing config scope differs; edit it explicitly before initializing another scope",
    );
  if (previous !== undefined && config.scope === undefined)
    throw new InputError(
      "Existing config has no scope; add it explicitly before init",
    );
  const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
  plan.push({
    path: configPath,
    action: previous === undefined ? "create" : "preserve",
    content:
      previous ??
      json({
        schemaVersion: 1,
        constraints: "constraints.json",
        handoff: "handoff.json",
        scope,
      }),
  });
  for (const [key, fallback, starter, validate] of [
    [
      "constraints",
      "constraints.json",
      { schemaVersion: 2, constraints: [] },
      parseManifest,
    ],
    [
      "handoff",
      "handoff.json",
      {
        schemaVersion: 2,
        task: "Describe the task being handed off",
        scope,
        capturedAt: new Date().toISOString(),
        activeConstraints: [],
      },
      parseHandoff,
    ],
  ] as const) {
    const path = resolve(root, config[key] ?? fallback);
    const old = await inspect(root, path);
    if (old !== undefined) validate(await readJson(path));
    plan.push({
      path,
      action: old === undefined ? "create" : "preserve",
      content: old ?? json(starter),
    });
  }
  const skill =
    options.agent === "none"
      ? ""
      : await readFile(
          new URL("../skills/handoff-check/SKILL.md", import.meta.url),
          "utf8",
        );
  const selected =
    options.agent === "both"
      ? ["codex", "claude"]
      : options.agent === "none"
        ? []
        : [options.agent];
  for (const agent of selected) {
    const skillPath = resolve(
      root,
      agent === "codex"
        ? ".agents/skills/handoff-check/SKILL.md"
        : ".claude/skills/handoff-check/SKILL.md",
    );
    const oldSkill = await inspect(root, skillPath);
    if (oldSkill !== undefined && oldSkill !== skill)
      throw new InputError(
        `Existing skill differs; review it before replacing: '${skillPath}'`,
      );
    plan.push({
      path: skillPath,
      action: oldSkill === undefined ? "create" : "preserve",
      content: skill,
    });
    const path = resolve(root, agent === "codex" ? "AGENTS.md" : "CLAUDE.md");
    const before = await inspect(root, path);
    if (before === undefined)
      plan.push({ path, action: "create", content: instruction });
    else {
      const startCount = before.split(begin).length - 1;
      const endCount = before.split(end).length - 1;
      if (startCount || endCount) {
        if (startCount !== 1 || endCount !== 1 || !before.includes(instruction))
          throw new InputError(
            `Conflicting handoff-check instruction block in '${path}'`,
          );
        plan.push({ path, action: "preserve", content: before });
      } else
        plan.push({
          path,
          action: "append",
          before,
          content: `${before.endsWith("\n") ? "\n" : "\n\n"}${instruction}`,
        });
    }
  }
  if (options.ci) {
    const path = resolve(root, ".github/workflows/handoff-check.yml");
    const content = `name: Handoff constraints\non: [push, pull_request]\npermissions:\n  contents: read\njobs:\n  verify:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 22\n      - run: npx --yes handoff-check@${metadata.version} verify --format json --require-content\n`;
    const old = await inspect(root, path);
    if (old !== undefined && old !== content)
      throw new InputError(`Existing CI workflow differs: '${path}'`);
    plan.push({
      path,
      action: old === undefined ? "create" : "preserve",
      content,
    });
  }
  const pathKey = (path: string) => path.normalize("NFC").toLowerCase();
  if (new Set(plan.map((file) => pathKey(file.path))).size !== plan.length)
    throw new InputError(
      "Initialization paths overlap; use separate config, manifest, handoff and integration files",
    );
  const written: string[] = [];
  for (const file of plan) {
    if (
      plan.some(
        (other) =>
          other !== file &&
          pathKey(other.path).startsWith(`${pathKey(file.path)}${sep}`),
      )
    )
      throw new InputError(
        "Initialization paths overlap as file and directory; choose separate paths",
      );
  }
  if (!options.dryRun) {
    for (const file of plan) {
      if (file.action === "preserve") continue;
      try {
        const current = await inspect(root, file.path);
        if (
          (file.action === "create" && current !== undefined) ||
          (file.action === "append" && current !== file.before)
        )
          throw new InputError("Target changed after planning");
        await mkdir(dirname(file.path), { recursive: true });
        await inspect(root, file.path);
        const flags =
          file.action === "create"
            ? constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL
            : constants.O_WRONLY |
              constants.O_APPEND |
              (constants.O_NOFOLLOW ?? 0);
        const handle = await open(file.path, flags, 0o644);
        try {
          await handle.writeFile(file.content, "utf8");
        } finally {
          await handle.close();
        }
        written.push(relative(root, file.path));
      } catch (error) {
        const message = error instanceof Error ? error.message : "write failed";
        throw new InputError(
          `Initialization stopped at '${relative(root, file.path)}': ${message}. Written files: ${written.join(", ") || "none"}. Inspect these paths before retrying; filesystem failures are not transactional.`,
        );
      }
    }
  }
  return {
    schemaVersion: 1,
    status: options.dryRun ? "preview" : "initialized",
    scope,
    files: plan.map((file) => ({
      path: relative(root, file.path),
      action: file.action,
      ...(file.action === "preserve" ? {} : { content: file.content }),
    })),
    notice:
      "Starter files may contain zero rules. Add reviewed project constraints, then capture a v2 snapshot. Existing v1 handoffs are preserved but cannot satisfy --require-content until explicitly migrated. Never refresh a baseline before verifying it on resume.",
  };
}
