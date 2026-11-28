import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { InputError, identifier } from "./validation.js";

export interface ProjectConfig {
  schemaVersion: 1 | 2;
  constraints?: string;
  handoff?: string;
  scope?: string;
  projectId?: string;
  profiles?: Record<
    string,
    { scope: string; constraints?: string; handoff?: string }
  >;
}

export class ProfileError extends InputError {}

export function selectProfile(
  config: ProjectConfig,
  profile?: string,
): ProjectConfig {
  if (profile === undefined) return config;
  identifier(profile, "--profile");
  if (
    config.schemaVersion !== 2 ||
    !config.profiles ||
    !Object.hasOwn(config.profiles, profile)
  )
    throw new ProfileError(
      `Unknown profile '${profile}'; explicitly define it in config v2`,
    );
  return { ...config, ...config.profiles[profile] };
}

export function digest(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export async function readBytes(path: string, regularOnly: boolean) {
  if (!regularOnly) return readFile(path);
  // Opening a FIFO in blocking mode can stall shutdown as well as the read.
  const handle = await open(
    path,
    constants.O_RDONLY | (constants.O_NONBLOCK ?? 0),
  );
  try {
    if (!(await handle.stat()).isFile())
      throw new InputError(`Expected a regular input file: '${path}'`);
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

export async function readJsonRecord(path: string, regularOnly = false) {
  let bytes: Buffer;
  try {
    bytes = await readBytes(path, regularOnly);
  } catch {
    throw new InputError(`Cannot read input file '${path}'`);
  }
  let input: unknown;
  try {
    input = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new InputError(`Invalid JSON in '${path}'`);
  }
  return { input, path, sha256: digest(bytes) };
}

export async function readJson(
  path: string,
  regularOnly = false,
): Promise<unknown> {
  return (await readJsonRecord(path, regularOnly)).input;
}

export function parseConfig(input: unknown): ProjectConfig {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new InputError("config: expected an object");
  const value = input as Record<string, unknown>;
  if (value.schemaVersion !== 1 && value.schemaVersion !== 2)
    throw new InputError("config.schemaVersion: expected 1 or 2");
  for (const key of Object.keys(value)) {
    if (
      ![
        "schemaVersion",
        "constraints",
        "handoff",
        "scope",
        ...(value.schemaVersion === 2 ? ["projectId", "profiles"] : []),
      ].includes(key)
    )
      throw new InputError(`config: unknown field '${key}'`);
  }
  const config: ProjectConfig = { schemaVersion: value.schemaVersion };
  for (const key of ["constraints", "handoff"] as const) {
    if (Object.hasOwn(value, key)) {
      if (typeof value[key] !== "string" || !value[key].trim())
        throw new InputError(`config.${key}: expected a non-empty path`);
      config[key] = value[key];
    }
  }
  if (Object.hasOwn(value, "scope"))
    config.scope = identifier(value.scope, "config.scope");
  if (Object.hasOwn(value, "projectId"))
    config.projectId = identifier(value.projectId, "config.projectId");
  if (Object.hasOwn(value, "profiles")) {
    if (
      !value.profiles ||
      typeof value.profiles !== "object" ||
      Array.isArray(value.profiles) ||
      !Object.keys(value.profiles).length
    )
      throw new InputError("config.profiles: expected a nonempty named object");
    config.profiles = Object.create(null) as NonNullable<
      ProjectConfig["profiles"]
    >;
    for (const [name, entry] of Object.entries(value.profiles)) {
      identifier(name, "config.profiles name");
      if (!entry || typeof entry !== "object" || Array.isArray(entry))
        throw new InputError(`config.profiles.${name}: expected an object`);
      const p = entry as Record<string, unknown>;
      if (
        Object.keys(p).some(
          (key) => !["scope", "constraints", "handoff"].includes(key),
        )
      )
        throw new InputError(`config.profiles.${name}: unknown field`);
      const parsed: { scope: string; constraints?: string; handoff?: string } =
        { scope: identifier(p.scope, `config.profiles.${name}.scope`) };
      for (const key of ["constraints", "handoff"] as const)
        if (Object.hasOwn(p, key)) {
          if (typeof p[key] !== "string" || !p[key].trim())
            throw new InputError(
              `config.profiles.${name}.${key}: expected non-empty path`,
            );
          parsed[key] = p[key];
        }
      config.profiles[name] = parsed;
    }
  }
  return config;
}

export async function loadConfig(
  cwd: string,
  explicit?: string,
  regularOnly = false,
  reader: (path: string) => Promise<Buffer> = (path) =>
    readBytes(path, regularOnly),
): Promise<{
  config: ProjectConfig;
  directory: string;
  source?: { path: string; sha256: string };
}> {
  const path = resolve(cwd, explicit ?? ".handoff-check.json");
  let input: Buffer;
  try {
    input = await reader(path);
  } catch (error) {
    if (
      explicit === undefined &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    )
      return { config: { schemaVersion: 1 }, directory: cwd };
    throw new InputError(`Cannot read config '${path}'`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.toString("utf8"));
  } catch {
    throw new InputError(`Invalid JSON in config '${path}'`);
  }
  return {
    config: parseConfig(parsed),
    directory: dirname(path),
    source: { path, sha256: digest(input) },
  };
}
