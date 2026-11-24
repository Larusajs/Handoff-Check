import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { InputError, identifier } from "./validation.js";

export interface ProjectConfig {
  schemaVersion: 1;
  constraints?: string;
  handoff?: string;
  scope?: string;
}

export async function readJson(path: string): Promise<unknown> {
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch {
    throw new InputError(`Cannot read input file '${path}'`);
  }
  try {
    return JSON.parse(content);
  } catch {
    throw new InputError(`Invalid JSON in '${path}'`);
  }
}

export function parseConfig(input: unknown): ProjectConfig {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new InputError("config: expected an object");
  const value = input as Record<string, unknown>;
  if (value.schemaVersion !== 1)
    throw new InputError("config.schemaVersion: expected 1");
  for (const key of Object.keys(value)) {
    if (!["schemaVersion", "constraints", "handoff", "scope"].includes(key))
      throw new InputError(`config: unknown field '${key}'`);
  }
  const config: ProjectConfig = { schemaVersion: 1 };
  for (const key of ["constraints", "handoff"] as const) {
    if (Object.hasOwn(value, key)) {
      if (typeof value[key] !== "string" || !value[key].trim())
        throw new InputError(`config.${key}: expected a non-empty path`);
      config[key] = value[key];
    }
  }
  if (Object.hasOwn(value, "scope"))
    config.scope = identifier(value.scope, "config.scope");
  return config;
}

export async function loadConfig(
  cwd: string,
  explicit?: string,
): Promise<{ config: ProjectConfig; directory: string }> {
  const path = resolve(cwd, explicit ?? ".handoff-check.json");
  let input: string;
  try {
    input = await readFile(path, "utf8");
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
    parsed = JSON.parse(input);
  } catch {
    throw new InputError(`Invalid JSON in config '${path}'`);
  }
  return { config: parseConfig(parsed), directory: dirname(path) };
}
