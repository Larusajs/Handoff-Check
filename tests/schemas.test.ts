import { expect, test } from "bun:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import { fullFormats } from "ajv-formats/dist/formats.js";
import configSchema from "../schemas/config.v1.schema.json" with {
  type: "json",
};
import manifestSchema from "../schemas/constraints.v1.schema.json" with {
  type: "json",
};
import handoffSchema from "../schemas/handoff.v1.schema.json" with {
  type: "json",
};
import { parseConfig } from "../src/config.js";
import { parseHandoff, parseManifest } from "../src/validation.js";

const ajv = new Ajv2020();
ajv.addFormat("date-time", fullFormats["date-time"]);
const manifestValid = ajv.compile(manifestSchema);
const handoffValid = ajv.compile(handoffSchema);
const configValid = ajv.compile(configSchema);
const rule = {
  id: "C-07",
  scope: "staging",
  description: "Review migrations",
  source: "synthetic:review",
};

test("published schemas and runtime accept the demo contracts", async () => {
  const manifest = await Bun.file(
    "examples/stale-handoff/constraints.json",
  ).json();
  expect(manifestValid(manifest)).toBe(true);
  expect(() => parseManifest(manifest)).not.toThrow();
  for (const file of ["handoff.json", "corrected-handoff.json"]) {
    const handoff = await Bun.file(`examples/stale-handoff/${file}`).json();
    expect(handoffValid(handoff)).toBe(true);
    expect(() => parseHandoff(handoff)).not.toThrow();
  }
});

test("schemas and runtime reject malformed structural fields", () => {
  for (const entry of [
    { ...rule, id: "C-07\n" },
    { ...rule, scope: " staging" },
    { ...rule, expiresAt: "2026-11-23T09:00:00+00:00" },
    { ...rule, replacedBy: "C-08" },
    { ...rule, source: " " },
    { ...rule, expiryAt: "2026-11-23T09:00:00Z" },
  ]) {
    const value = { schemaVersion: 1, constraints: [entry] };
    expect(manifestValid(value)).toBe(false);
    expect(() => parseManifest(value)).toThrow();
  }
  for (const ids of [["C-07\n"], ["C-07", "C-07"], [null]]) {
    const value = { schemaVersion: 1, task: "Resume", activeConstraints: ids };
    expect(handoffValid(value)).toBe(false);
    expect(() => parseHandoff(value)).toThrow();
  }
});

test("config schema and runtime agree on project options", () => {
  for (const value of [
    { schemaVersion: 1 },
    {
      schemaVersion: 1,
      constraints: "inputs/rules.json",
      handoff: "inputs/handoff.json",
      scope: "production",
    },
  ]) {
    expect(configValid(value)).toBe(true);
    expect(() => parseConfig(value)).not.toThrow();
  }
  for (const value of [
    { schemaVersion: 2 },
    { schemaVersion: 1, unknown: true },
    { schemaVersion: 1, scope: "staging\n" },
    { schemaVersion: 1, handoff: " " },
  ]) {
    expect(configValid(value)).toBe(false);
    expect(() => parseConfig(value)).toThrow();
  }
});
