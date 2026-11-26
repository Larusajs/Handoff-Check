import { open } from "node:fs/promises";
import { resolve } from "node:path";
import { loadConfig, readJson, selectProfile } from "./config.js";
import { terminalText } from "./render.js";
import {
  parseReviewRegistry,
  recordReview,
  reviewRules,
  reviewText,
} from "./review.js";
import {
  InputError,
  identifier,
  parseManifest,
  timestamp,
} from "./validation.js";
import { checkProject } from "./verifier.js";

interface ReviewOptions {
  config?: string;
  profile?: string;
  scope?: string;
  constraints?: string;
  registry?: string;
  owner?: string;
  "review-by"?: string;
  "as-of"?: string;
  output?: string;
  format: string;
}

export async function reviewCommand(
  cwd: string,
  command: "review" | "review-record",
  options: ReviewOptions,
): Promise<number> {
  if (
    options.profile !== undefined &&
    [options.scope, options.constraints].some((v) => v !== undefined)
  )
    throw new InputError(
      "--profile cannot be combined with --scope or --constraints",
    );
  for (const key of ["config", "constraints", "registry", "output"] as const)
    if (options[key] !== undefined && !options[key].trim())
      throw new InputError(`--${key}: expected a non-empty path`);
  if (command === "review" && options.registry === undefined)
    throw new InputError(
      "review requires --registry <review-file>; no review file is discovered implicitly",
    );
  if (
    command === "review-record" &&
    (options.owner === undefined || options["review-by"] === undefined)
  )
    throw new InputError(
      "review-record requires --owner and --review-by after reviewing the current rules",
    );
  if (command === "review-record" && options.format === "markdown")
    throw new InputError(
      "review-record supports text or json acknowledgement; its record is always JSON",
    );
  const loaded = await loadConfig(cwd, options.config, true);
  const config = selectProfile(loaded.config, options.profile);
  const scope = identifier(
    options.scope ?? config.scope,
    "--scope (or config.scope)",
  );
  const manifest = parseManifest(
    await readJson(
      options.constraints !== undefined
        ? resolve(cwd, options.constraints)
        : resolve(loaded.directory, config.constraints ?? "constraints.json"),
      true,
    ),
  );
  checkProject(manifest, undefined, config.projectId);
  if (command === "review") {
    const registry = parseReviewRegistry(
      await readJson(resolve(cwd, options.registry as string), true),
    );
    const asOf = options["as-of"] ?? new Date().toISOString();
    timestamp(asOf, "--as-of");
    const result = reviewRules(manifest, registry, scope, asOf);
    process.stdout.write(
      options.format === "json"
        ? `${JSON.stringify(result, null, 2)}\n`
        : reviewText(result, options.format === "markdown"),
    );
    return result.status === "current" ? 0 : 1;
  }
  const asOf = options["as-of"] ?? new Date().toISOString();
  timestamp(asOf, "--as-of");
  const record = recordReview(
    manifest,
    scope,
    asOf,
    options.owner as string,
    options["review-by"] as string,
  );
  const content = `${JSON.stringify(record, null, 2)}\n`;
  if (options.output === undefined) process.stdout.write(content);
  else {
    const path = resolve(cwd, options.output);
    let handle: Awaited<ReturnType<typeof open>>;
    try {
      handle = await open(path, "wx", 0o644);
    } catch {
      throw new InputError(
        `Cannot create review record '${path}'; choose a new file with an existing parent directory`,
      );
    }
    try {
      await handle.writeFile(content, "utf8");
    } catch {
      throw new InputError(
        `Cannot finish review record '${path}'; the new file may be partial. Inspect it before retrying.`,
      );
    } finally {
      await handle.close();
    }
    process.stdout.write(
      options.format === "json"
        ? `${JSON.stringify({ schemaVersion: 1, status: "recorded", path, entries: record.rules.length })}\n`
        : `RECORDED ${terminalText(path)} | ${record.rules.length} reviewed rule references\n`,
    );
  }
  return 0;
}
