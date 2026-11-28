import { resolve } from "node:path";
import {
  type CombinedCheck,
  combineChecks,
  combinedText,
  type Section,
} from "./check.js";
import { loadConfig, readBytes, selectProfile } from "./config.js";
import type { Handoff, Manifest } from "./contracts.js";
import { terminalText } from "./render.js";
import {
  parseReviewRegistry,
  type ReviewRegistry,
  reviewRules,
} from "./review.js";
import { readSourceTargets } from "./source-files.js";
import {
  checkSources,
  parseSourceRegistry,
  type SourceObservation,
  type SourceRegistry,
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

export interface CheckOptions {
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
type Parsed<T> = { value: T } | { error: string };
export interface PreparedCheck {
  manifest: Manifest;
  scope: string;
  projectId?: string;
  profile?: string;
  selectionTime: string;
  handoff: Parsed<Handoff>;
  review?: Parsed<ReviewRegistry>;
  sources?: Parsed<SourceRegistry>;
  observations: ReadonlyMap<string, SourceObservation>;
}
export const checkDependencies = {
  read: (path: string) => readBytes(path, true),
  clock: () => new Date().toISOString(),
  sources: readSourceTargets,
};
function diagnostic(error: unknown): string {
  return terminalText(
    error instanceof InputError
      ? error.message
      : "Cannot complete selected check",
  ).slice(0, 512);
}
function parsed<T>(evaluate: () => T): Parsed<T> {
  try {
    return { value: evaluate() };
  } catch (error) {
    return { error: diagnostic(error) };
  }
}
/** Read and parse each metadata role once; only preparation performs source I/O. */
export async function prepareCheck(
  cwd: string,
  options: CheckOptions,
  dependencies = checkDependencies,
): Promise<PreparedCheck> {
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
  const role = async <T>(
    path: string,
    parse: (input: unknown) => T,
  ): Promise<Parsed<T>> => {
    try {
      const input = await json(path);
      return parsed(() => parse(input));
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
  const handoff = await role(
    options.handoff === undefined
      ? resolve(loaded.directory, config.handoff ?? "handoff.json")
      : resolve(cwd, options.handoff),
    (input) => {
      const value = parseHandoff(input);
      if (value.schemaVersion === 1)
        throw new InputError(
          "check requires a content-aware v2/v3/v4 handoff; review and capture a baseline explicitly",
        );
      return value;
    },
  );
  const review =
    options.registry === undefined
      ? undefined
      : await role(resolve(cwd, options.registry), parseReviewRegistry);
  let sources =
    options.sources === undefined
      ? undefined
      : await role(resolve(cwd, options.sources), parseSourceRegistry);
  const selectionTime = new Date(
    timestamp(options["as-of"] ?? dependencies.clock(), "--as-of"),
  ).toISOString();
  let observations: ReadonlyMap<string, SourceObservation> = new Map();
  if (sources && "value" in sources) {
    try {
      const targets = sourceCheckTargets(
        manifest,
        sources.value,
        scope,
        selectionTime,
      );
      observations = await dependencies.sources(loaded.directory, targets);
    } catch (error) {
      sources = { error: diagnostic(error) };
    }
  }
  return {
    manifest,
    scope,
    selectionTime,
    handoff,
    observations,
    ...(review === undefined ? {} : { review }),
    ...(sources === undefined ? {} : { sources }),
    ...(projectId === undefined ? {} : { projectId }),
    ...(options.profile === undefined ? {} : { profile: options.profile }),
  };
}
/** Synchronous, read-only evaluation of prepared objects and existing observations. */
export function evaluatePrepared(
  prepared: PreparedCheck,
  asOf: string,
): CombinedCheck {
  const time = new Date(timestamp(asOf, "asOf")).toISOString();
  const { manifest, scope } = prepared;
  const selected = <T, R>(
    input: Parsed<T>,
    evaluate: (value: T) => R,
    passed: (result: R) => boolean,
  ): Exclude<Section<R>, { status: "not-requested" }> => {
    if ("error" in input) return { status: "invalid", error: input.error };
    const result = parsed(() => evaluate(input.value));
    return "error" in result
      ? { status: "invalid", error: result.error }
      : {
          status: passed(result.value) ? "passed" : "attention",
          result: result.value,
        };
  };
  const verification = selected(
    prepared.handoff,
    (handoff) =>
      verify(manifest, handoff, scope, time, {
        requireActive: true,
        ...(prepared.projectId === undefined
          ? {}
          : { projectId: prepared.projectId }),
      }),
    (r) => r.status === "verified",
  );
  const review =
    prepared.review === undefined
      ? { status: "not-requested" as const }
      : selected(
          prepared.review,
          (registry) => reviewRules(manifest, registry, scope, time),
          (r) => r.status === "current",
        );
  const sources =
    prepared.sources === undefined
      ? { status: "not-requested" as const }
      : selected(
          prepared.sources,
          (registry) =>
            checkSources(
              manifest,
              registry,
              scope,
              time,
              prepared.observations,
            ),
          (r) => r.status === "unchanged",
        );
  return combineChecks(
    {
      scope,
      asOf: time,
      activeConstraintCount: explain(manifest, scope, time).rules.filter(
        (r) => r.decision === "ACTIVE",
      ).length,
      ...(prepared.profile === undefined ? {} : { profile: prepared.profile }),
      ...(prepared.projectId === undefined
        ? {}
        : { projectId: prepared.projectId }),
    },
    { verification, review, sources },
  );
}
export async function combinedCheck(
  cwd: string,
  options: CheckOptions,
  dependencies = checkDependencies,
): Promise<{ report: CombinedCheck; handoff?: Handoff }> {
  const prepared = await prepareCheck(cwd, options, dependencies);
  return {
    report: evaluatePrepared(prepared, prepared.selectionTime),
    ...("value" in prepared.handoff ? { handoff: prepared.handoff.value } : {}),
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
