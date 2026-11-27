import { open } from "node:fs/promises";
import { resolve } from "node:path";
import { loadConfig, readJson, selectProfile } from "./config.js";
import { terminalText } from "./render.js";
import { readSourceTargets } from "./source-files.js";
import {
  checkSources,
  parseSourcePlan,
  parseSourceRegistry,
  recordSourceTargets,
  sourceCheckTargets,
  sourceText,
} from "./sources.js";
import {
  InputError,
  identifier,
  parseManifest,
  timestamp,
} from "./validation.js";
import { checkProject } from "./verifier.js";

interface SourceOptions {
  config?: string;
  profile?: string;
  scope?: string;
  constraints?: string;
  bindings?: string;
  sources?: string;
  output?: string;
  "as-of"?: string;
  format: string;
}

export async function sourceCommand(
  cwd: string,
  command: "source-check" | "source-record",
  options: SourceOptions,
): Promise<number> {
  if (
    options.profile !== undefined &&
    [options.scope, options.constraints].some((v) => v !== undefined)
  )
    throw new InputError(
      "--profile cannot be combined with --scope or --constraints",
    );
  for (const key of [
    "config",
    "constraints",
    "bindings",
    "sources",
    "output",
  ] as const)
    if (options[key] !== undefined && !options[key].trim())
      throw new InputError(`--${key}: expected a non-empty path`);
  const input = command === "source-check" ? options.sources : options.bindings;
  if (input === undefined)
    throw new InputError(
      command === "source-check"
        ? "source-check requires --sources <registry-file>"
        : "source-record requires --bindings <binding-plan> after reviewing the explicit local files",
    );
  if (command === "source-record" && options.format === "markdown")
    throw new InputError(
      "source-record supports text or json acknowledgement; its record is always JSON",
    );
  const loaded = await loadConfig(cwd, options.config, true);
  const config = selectProfile(loaded.config, options.profile);
  const scope = identifier(
    options.scope ?? config.scope,
    "--scope (or config.scope)",
  );
  const manifest = parseManifest(
    await readJson(
      options.constraints === undefined
        ? resolve(loaded.directory, config.constraints ?? "constraints.json")
        : resolve(cwd, options.constraints),
      true,
    ),
  );
  checkProject(manifest, undefined, config.projectId);
  const metadata = await readJson(resolve(cwd, input), true);
  const asOf = options["as-of"] ?? new Date().toISOString();
  timestamp(asOf, "--as-of");
  if (command === "source-check") {
    const registry = parseSourceRegistry(metadata);
    const targets = sourceCheckTargets(manifest, registry, scope, asOf);
    const observed = await readSourceTargets(loaded.directory, targets);
    const result = checkSources(manifest, registry, scope, asOf, observed);
    process.stdout.write(
      options.format === "json"
        ? `${JSON.stringify(result, null, 2)}\n`
        : sourceText(result, options.format === "markdown"),
    );
    return result.status === "unchanged" ? 0 : 1;
  }
  const plan = parseSourcePlan(metadata);
  const targets = recordSourceTargets(manifest, plan, scope, asOf);
  const observed = await readSourceTargets(loaded.directory, targets);
  const sources = targets.map((target) => {
    const observation = observed.get(target.path);
    if (observation?.status !== "READ")
      throw new InputError(
        `Cannot record source for '${target.id}': ${observation?.status ?? "SOURCE_UNREADABLE"}; no record created`,
      );
    return { ...target, fileHash: observation.fileHash };
  });
  const registry = parseSourceRegistry({
    schemaVersion: 1,
    ...(manifest.projectId === undefined
      ? {}
      : { projectId: manifest.projectId }),
    capturedAt: asOf,
    sources,
  });
  const content = `${JSON.stringify(registry, null, 2)}\n`;
  if (options.output === undefined) process.stdout.write(content);
  else {
    const path = resolve(cwd, options.output);
    let handle: Awaited<ReturnType<typeof open>>;
    try {
      handle = await open(path, "wx", 0o644);
    } catch {
      throw new InputError(
        `Cannot create source record '${path}'; choose a new file with an existing parent directory`,
      );
    }
    try {
      await handle.writeFile(content, "utf8");
    } catch {
      throw new InputError(
        `Cannot finish source record '${path}'; the new file may be partial. Inspect it before retrying.`,
      );
    } finally {
      await handle.close();
    }
    process.stdout.write(
      options.format === "json"
        ? `${JSON.stringify({ schemaVersion: 1, status: "recorded", path, entries: registry.sources.length })}\n`
        : `RECORDED ${terminalText(path)} | ${registry.sources.length} local source references\n`,
    );
  }
  return 0;
}
