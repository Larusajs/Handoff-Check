import { describe, expect, test } from "bun:test";
import type { Constraint } from "../src/contracts.js";
import { parseHandoff, parseManifest, timestamp } from "../src/validation.js";
import { verify } from "../src/verifier.js";

const clock = "2026-11-23T09:00:00Z";
const rule: Constraint = {
  id: "C-07",
  scope: "staging",
  description: "Review migrations",
  source: "synthetic:review",
};

function check(
  rules: Constraint[],
  ids: string[],
  scope = "staging",
  asOf = clock,
) {
  return verify(
    parseManifest({ schemaVersion: 1, constraints: rules }),
    parseHandoff({ schemaVersion: 1, task: "Resume", activeConstraints: ids }),
    scope,
    asOf,
  );
}

describe("verification", () => {
  test("clean handoff and empty manifest pass", () => {
    expect(check([rule], [rule.id]).status).toBe("verified");
    expect(check([], []).status).toBe("verified");
  });

  test("global rules accompany the selected scope", () => {
    const global = { ...rule, id: "G-01", scope: "global" };
    expect(check([rule, global], [rule.id, global.id]).status).toBe("verified");
    expect(check([rule, global], [], "production").expectedConstraints).toEqual(
      ["G-01"],
    );
    expect(check([rule, global], [global.id], "global").status).toBe(
      "verified",
    );
  });

  test("PDF example reports both stale freeze and missing review", () => {
    const result = check(
      [{ ...rule, id: "C-02", expiresAt: "2026-11-20T18:00:00Z" }, rule],
      ["C-02"],
    );
    expect(result.findings.map(({ code, id }) => [code, id])).toEqual([
      ["EXPIRED", "C-02"],
      ["MISSING", "C-07"],
    ]);
  });

  test.each(["expiresAt", "revokedAt"] as const)(
    "%s transitions at the exact boundary",
    (field) => {
      const rules = [{ ...rule, [field]: clock }];
      expect(
        check(rules, [rule.id], "staging", "2026-11-23T08:59:59.999Z").status,
      ).toBe("verified");
      expect(check(rules, [rule.id]).findings[0]?.code).toBe(
        field === "expiresAt" ? "EXPIRED" : "REVOKED",
      );
      expect(
        check(rules, [], "staging", "2026-11-23T09:00:00.001Z").status,
      ).toBe("verified");
    },
  );

  test("replacement has an explicit boundary and never reactivates the old rule", () => {
    const old = { ...rule, replacedBy: "C-08", supersededAt: clock };
    const replacement = { ...rule, id: "C-08" };
    expect(
      check(
        [old, replacement],
        [rule.id, "C-08"],
        "staging",
        "2026-11-23T08:59:59Z",
      ).status,
    ).toBe("verified");
    expect(check([old, replacement], [rule.id, "C-08"]).findings[0]?.code).toBe(
      "SUPERSEDED",
    );
    expect(
      check([old, { ...replacement, revokedAt: clock }], [])
        .expectedConstraints,
    ).toEqual([]);
  });

  test("unknown and wrong-scope IDs fail with primary lifecycle precedence", () => {
    const result = check(
      [{ ...rule, scope: "production", revokedAt: clock, expiresAt: clock }],
      [rule.id, "Z-01"],
    );
    expect(result.findings.map((f) => f.code)).toEqual([
      "OUT_OF_SCOPE",
      "UNKNOWN",
    ]);
    expect(
      check([{ ...rule, revokedAt: clock, expiresAt: clock }], [rule.id])
        .findings[0]?.code,
    ).toBe("REVOKED");
  });

  test("output is stable under reordered inputs and inputs remain unchanged", () => {
    const rules = [rule, { ...rule, id: "A-01" }];
    const original = JSON.stringify(rules);
    const first = check(rules, ["Z", "A-01"]);
    expect(check([...rules].reverse(), ["A-01", "Z"])).toEqual(first);
    expect(JSON.stringify(rules)).toBe(original);
    expect(first.asOf).toBe("2026-11-23T09:00:00.000Z");
  });
});

test("valid replacement chains resolve without reactivating earlier rules", () => {
  const first = {
    ...rule,
    replacedBy: "C-08",
    supersededAt: "2026-11-22T09:00:00Z",
  };
  const second = {
    ...rule,
    id: "C-08",
    replacedBy: "C-09",
    supersededAt: clock,
  };
  const third = { ...rule, id: "C-09" };
  const result = check([first, second, third], ["C-07", "C-08", "C-09"]);
  expect(result.expectedConstraints).toEqual(["C-09"]);
  expect(result.findings.map((finding) => [finding.id, finding.code])).toEqual([
    ["C-07", "SUPERSEDED"],
    ["C-08", "SUPERSEDED"],
  ]);
});

test("lifecycle precedence favors revocation, then supersession, then expiry", () => {
  const replacement = { ...rule, id: "C-08" };
  const old = {
    ...rule,
    replacedBy: "C-08",
    supersededAt: clock,
    expiresAt: clock,
  };
  expect(
    check([old, replacement], [rule.id, replacement.id]).findings[0]?.code,
  ).toBe("SUPERSEDED");
  expect(
    check(
      [{ ...old, revokedAt: clock }, replacement],
      [rule.id, replacement.id],
    ).findings[0]?.code,
  ).toBe("REVOKED");
});

describe("input validation", () => {
  test.each([
    "2026-02-30T00:00:00Z",
    "2026-11-23T24:00:00Z",
    "2026-11-23T09:00:00+00:00",
    "2026-11-23",
    "yesterday",
    "2026-11-23T09:00:00.0001Z",
  ])("rejects invalid timestamp %s", (value) => {
    expect(() => timestamp(value, "time")).toThrow();
  });

  test.each([
    "2024-02-29T00:00:00Z",
    "2026-11-23T09:00:00.1Z",
    "2026-11-23T09:00:00.123Z",
  ])("accepts valid timestamp %s", (value) => {
    expect(Number.isFinite(timestamp(value, "time"))).toBe(true);
  });

  test("rejects duplicate IDs in either input", () => {
    expect(() => check([rule, rule], [])).toThrow("duplicate ID");
    expect(() => check([rule], [rule.id, rule.id])).toThrow("duplicate ID");
  });

  test.each([
    { ...rule, replacedBy: "absent", supersededAt: clock },
    { ...rule, replacedBy: rule.id, supersededAt: clock },
    { ...rule, replacedBy: "other" },
    { ...rule, supersededAt: clock },
    { ...rule, expiresAt: null },
    { ...rule, scope: "" },
    { ...rule, source: " " },
    { ...rule, expiryAt: clock },
  ])("rejects malformed or invalid lifecycle rule %#", (value) => {
    expect(() =>
      parseManifest({ schemaVersion: 1, constraints: [value] }),
    ).toThrow();
  });

  test("rejects cross-scope replacements and cycles", () => {
    const a = { ...rule, replacedBy: "C-08", supersededAt: clock };
    expect(() =>
      check([a, { ...rule, id: "C-08", scope: "global" }], []),
    ).toThrow("same scope");
    expect(() =>
      check(
        [a, { ...rule, id: "C-08", replacedBy: rule.id, supersededAt: clock }],
        [],
      ),
    ).toThrow("cycle");
  });

  test("rejects unsupported formats, unknown fields, and malformed handoffs", () => {
    for (const value of [
      null,
      [],
      {},
      { schemaVersion: 3, constraints: [] },
      { schemaVersion: 1, constraints: [], extra: true },
    ]) {
      expect(() => parseManifest(value)).toThrow();
    }
    for (const value of [
      null,
      {},
      { schemaVersion: 1, task: " ", activeConstraints: [] },
      { schemaVersion: 1, task: "Resume", activeConstraints: [2] },
    ]) {
      expect(() => parseHandoff(value)).toThrow();
    }
  });
});
