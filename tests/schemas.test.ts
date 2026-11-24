import { expect, test } from "bun:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import { fullFormats } from "ajv-formats/dist/formats.js";
import manifestSchema from "../schemas/constraints.v1.schema.json" with {
  type: "json",
};
import handoffSchema from "../schemas/handoff.v1.schema.json" with {
  type: "json",
};
import { parseHandoff, parseManifest } from "../src/validation.js";

const ajv = new Ajv2020();
ajv.addFormat("date-time", fullFormats["date-time"]);
const manifestValid = ajv.compile(manifestSchema);
const handoffValid = ajv.compile(handoffSchema);
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
