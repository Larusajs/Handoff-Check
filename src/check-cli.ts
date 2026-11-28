import { resolve } from "node:path";
import {
  type CombinedCheck,
  combineChecks,
  combinedText,
  type Section,
} from "./check.js";
import { loadConfig, readBytes, selectProfile } from "./config.js";
import type { Handoff } from "./contracts.js";
import { terminalText } from "./render.js";
import { parseReviewRegistry, reviewRules } from "./review.js";
import { readSourceTargets } from "./source-files.js";
import {
  checkSources,
  parseSourceRegistry,
  sourceCheckTargets,
} from "./sources.js";
import {
  InputError,
  identifier,
  parseHandoff,
  parseManifest,
  timestamp,
} from "./validation.js";
import { checkProject, explain, verify } from "./verifier.js";

interface CheckOptions {
  config?: string;
  profile?: string;
  scope?: string;
  constraints?: string;
  handoff?: string;
  registry?: string;
  sources?: string;
  "as-of"?: string;
  format: string;
}
type ReadResult = { input: unknown } | { error: string };
function diagnostic(error: unknown): string {
  return terminalText(
    error instanceof InputError
      ? error.message
      : "Cannot complete selected check",
  ).slice(0, 512);
}

/** CLI-owned I/O; each resolved metadata pathname is observed once, including failures. */
export async function combinedCheck(
  cwd: string,
  options: CheckOptions,
  dependencies = {
    read: (path: string) => readBytes(path, true),
    clock: () => new Date().toISOString(),
    sources: readSourceTargets,
  },
): Promise<{ report: CombinedCheck; handoff?: Handoff }> {
  if (
    options.profile !== undefined &&
    [options.scope, options.constraints, options.handoff].some(
      (v) => v !== undefined,
    )
  )
    throw new InputError(
      "--profile cannot be combined with --scope, --constraints or --handoff",
    );
  for (const key of [
    "config",
    "constraints",
    "handoff",
    "registry",
    "sources",
  ] as const)
    if (options[key] !== undefined && !options[key].trim())
      throw new InputError(`--${key}: expected a non-empty path`);
  const cache = new Map<string, Promise<Buffer>>();
  const read = (path: string) => {
    const key = resolve(path);
    let entry = cache.get(key);
    if (!entry) {
      entry = Promise.resolve().then(() => dependencies.read(key));
      cache.set(key, entry);
    }
    return entry;
  };
  const json = async (path: string) => {
    let bytes: Buffer;
    try {
      bytes = await read(path);
    } catch {
      throw new InputError(`Cannot read input file '${path}'`);
    }
    try {
      return JSON.parse(bytes.toString("utf8")) as unknown;
    } catch {
      throw new InputError(`Invalid JSON in '${path}'`);
    }
  };
  const role = async (path: string): Promise<ReadResult> => {
    try {
      return { input: await json(path) };
    } catch (error) {
      return { error: diagnostic(error) };
    }
  };
  const loaded = await loadConfig(cwd, options.config, true, read);
  const config = selectProfile(loaded.config, options.profile);
  const scope = identifier(
    options.scope ?? config.scope,
    "--scope (or config.scope)",
  );
  const manifest = parseManifest(
    await json(
      options.constraints === undefined
        ? resolve(loaded.directory, config.constraints ?? "constraints.json")
        : resolve(cwd, options.constraints),
    ),
  );
  const projectId = checkProject(manifest, undefined, config.projectId);
  const handoffInput = await role(
    options.handoff === undefined
      ? resolve(loaded.directory, config.handoff ?? "handoff.json")
      : resolve(cwd, options.handoff),
  );
  const reviewInput =
    options.registry === undefined
      ? undefined
      : await role(resolve(cwd, options.registry));
  const sourceInput =
    options.sources === undefined
      ? undefined
      : await role(resolve(cwd, options.sources));
  const asOf = new Date(
    timestamp(options["as-of"] ?? dependencies.clock(), "--as-of"),
  ).toISOString();
  let handoff: Handoff | undefined;
  const selected = <T>(
    input: ReadResult,
    evaluate: (value: unknown) => T,
    passed: (result: T) => boolean,
  ): Exclude<Section<T>, { status: "not-requested" }> => {
    if ("error" in input) return { status: "invalid", error: input.error };
    try {
      const result = evaluate(input.input);
      return { status: passed(result) ? "passed" : "attention", result };
    } catch (error) {
      return { status: "invalid", error: diagnostic(error) };
    }
  };
  const verification = selected(
    handoffInput,
    (input) => {
      const parsed = parseHandoff(input);
      if (parsed.schemaVersion === 1)
        throw new InputError(
          "check requires a content-aware v2/v3/v4 handoff; review and capture a baseline explicitly",
        );
      const result = verify(manifest, parsed, scope, asOf, {
        requireActive: true,
        ...(config.projectId === undefined
          ? {}
          : { projectId: config.projectId }),
      });
      handoff = parsed;
      return result;
    },
    (result) => result.status === "verified",
  );
  const review =
    reviewInput === undefined
      ? { status: "not-requested" as const }
      : selected(
          reviewInput,
          (input) =>
            reviewRules(manifest, parseReviewRegistry(input), scope, asOf),
          (result) => result.status === "current",
        );
  let sources: CombinedCheck["checks"]["sources"] = { status: "not-requested" };
  if (sourceInput !== undefined) {
    if ("error" in sourceInput)
      sources = { status: "invalid", error: sourceInput.error };
    else
      try {
        const registry = parseSourceRegistry(sourceInput.input);
        const targets = sourceCheckTargets(manifest, registry, scope, asOf);
        const observations = await dependencies.sources(
          loaded.directory,
          targets,
        );
        const result = checkSources(
          manifest,
          registry,
          scope,
          asOf,
          observations,
        );
        sources = {
          status: result.status === "unchanged" ? "passed" : "attention",
          result,
        };
      } catch (error) {
        sources = { status: "invalid", error: diagnostic(error) };
      }
  }
  return {
    report: combineChecks(
      {
        scope,
        asOf,
        activeConstraintCount: explain(manifest, scope, asOf).rules.filter(
          (r) => r.decision === "ACTIVE",
        ).length,
        ...(options.profile === undefined ? {} : { profile: options.profile }),
        ...(projectId === undefined ? {} : { projectId }),
      },
      { verification, review, sources },
    ),
    ...(handoff === undefined ? {} : { handoff }),
  };
}

export async function checkCommand(
  cwd: string,
  options: CheckOptions,
): Promise<number> {
  const { report, handoff } = await combinedCheck(cwd, options);
  process.stdout.write(
    options.format === "json"
      ? `${JSON.stringify(report, null, 2)}\n`
      : combinedText(report, options.format === "markdown", handoff),
  );
  return report.status === "invalid"
    ? 2
    : report.status === "attention"
      ? 1
      : 0;
}
