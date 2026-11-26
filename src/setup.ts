import { lstat, open, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { parseConfig } from "./config.js";
import { terminalText } from "./render.js";
import { InputError, identifier, parseManifest } from "./validation.js";
import { snapshot } from "./verifier.js";

export interface SetupAnswers {
  projectId: string;
  scopes: string[];
  ruleId: string;
  description: string;
  source: string;
  task: string;
}

/** A new, explicitly reviewed global rule; no policy is inferred from the repo. */
export function setupPlan(answers: SetupAnswers, asOf: string) {
  const projectId = identifier(answers.projectId, "Project ID");
  const scopes = answers.scopes.map((scope) =>
    identifier(scope, "Environment"),
  );
  if (
    !scopes.length ||
    scopes.length > 20 ||
    new Set(scopes).size !== scopes.length ||
    new Set(scopes.map((s) => s.toLowerCase())).size !== scopes.length
  )
    throw new InputError(
      "Enter 1 to 20 unique environments (case-insensitive filenames)",
    );
  const manifest = parseManifest({
    schemaVersion: 3,
    projectId,
    constraints: [
      {
        id: identifier(answers.ruleId, "Rule ID"),
        revision: 1,
        scope: "global",
        description: answers.description,
        source: answers.source,
      },
    ],
  });
  const profiles = Object.fromEntries(
    scopes.map((scope) => [scope, { scope, handoff: `handoff-${scope}.json` }]),
  );
  const config = parseConfig({
    schemaVersion: 2,
    projectId,
    constraints: "constraints.json",
    profiles,
  });
  const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
  return [
    { path: ".handoff-check.json", content: json(config) },
    { path: "constraints.json", content: json(manifest) },
    ...scopes.map((scope) => ({
      path: `handoff-${scope}.json`,
      content: json(
        snapshot(manifest, answers.task, scope, asOf, {
          includeContent: true,
          projectId,
        }),
      ),
    })),
  ];
}

export async function assertSetupTargets(
  root: string,
  files: { path: string }[],
) {
  const existing = new Set(
    (await readdir(root)).map((name) => name.normalize("NFC").toLowerCase()),
  );
  for (const file of files) {
    if (existing.has(file.path.normalize("NFC").toLowerCase()))
      throw new InputError(
        `Setup requires new files; target already exists: '${file.path}'.`,
      );
    try {
      await lstat(resolve(root, file.path));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    throw new InputError(
      `Setup requires new files; target already exists: '${file.path}'. Use init or edit existing configuration explicitly.`,
    );
  }
}

export async function writeSetup(
  root: string,
  files: { path: string; content: string }[],
) {
  await assertSetupTargets(root, files);
  const written: string[] = [];
  for (const file of files) {
    try {
      const handle = await open(resolve(root, file.path), "wx", 0o644);
      try {
        await handle.writeFile(file.content, "utf8");
      } finally {
        await handle.close();
      }
      written.push(file.path);
    } catch {
      throw new InputError(
        `Setup stopped at '${file.path}'. Written files: ${written.join(", ") || "none"}. Filesystem writes are not transactional; inspect before retrying.`,
      );
    }
  }
}

export async function guidedSetup(root: string, dryRun: boolean) {
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new InputError(
      "setup requires an interactive terminal; use init --scope <scope> for automation",
    );
  await assertSetupTargets(root, [
    { path: ".handoff-check.json" },
    { path: "constraints.json" },
  ]);
  const reader = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const abort = new AbortController();
  reader.on("SIGINT", () => {
    abort.abort();
    reader.close();
  });
  reader.on("close", () => abort.abort());
  const ask = async (prompt: string) => {
    try {
      return (await reader.question(prompt, { signal: abort.signal })).trim();
    } catch {
      throw new InputError("Setup cancelled before approval; no files written");
    }
  };
  try {
    process.stdout.write(
      "Create a project-bound starter with one real rule applying to every environment.\nNo agent settings, hooks, CI, or dependencies will be installed.\n",
    );
    const projectId = await ask("Project ID: ");
    const scopes = (
      await ask("Environments (comma-separated, e.g. staging,production): ")
    )
      .split(",")
      .map((s) => s.trim());
    const ruleId = await ask("First rule ID: ");
    const description = await ask("Rule applying to ALL environments: ");
    const source = await ask(
      "Rule source reference (stored as text, never fetched): ",
    );
    const task = await ask("Initial handoff task: ");
    const files = setupPlan(
      { projectId, scopes, ruleId, description, source, task },
      new Date().toISOString(),
    );
    await assertSetupTargets(root, files);
    process.stdout.write(
      "\nReview the exact proposed files and retained rule content:\n",
    );
    for (const file of files)
      process.stdout.write(
        `\n--- ${file.path} ---\n${file.content.split("\n").map(terminalText).join("\n")}\n`,
      );
    if (dryRun) {
      process.stdout.write("PREVIEW ONLY: no files written.\n");
      return;
    }
    if (
      (await ask(
        "Adopt these reviewed rules and create these new baselines? Type yes: ",
      )) !== "yes"
    ) {
      process.stdout.write("CANCELLED: no files written.\n");
      return;
    }
    await writeSetup(root, files);
    process.stdout.write(
      `CREATED ${files.length} files.\nNext: handoff-check verify --profile ${scopes[0]} --require-content --require-active\nEdit and review constraints before relying on them. Never refresh a baseline before verifying it on resume.\n`,
    );
  } finally {
    reader.close();
  }
}
