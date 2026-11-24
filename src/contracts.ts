export interface Constraint {
  id: string;
  scope: string;
  description: string;
  source: string;
  revision?: number;
  expiresAt?: string;
  revokedAt?: string;
  replacedBy?: string;
  supersededAt?: string;
}

export interface Manifest {
  schemaVersion: 1 | 2;
  constraints: Constraint[];
}

export interface LegacyHandoff {
  schemaVersion: 1;
  task: string;
  activeConstraints: string[];
}

export interface RuleReference {
  id: string;
  revision: number;
  contentHash: string;
}

export interface ContentHandoff {
  schemaVersion: 2;
  task: string;
  scope: string;
  capturedAt: string;
  activeConstraints: RuleReference[];
}

export interface RetainedReference extends RuleReference {
  content: Constraint & { revision: number };
}

export interface RetainedHandoff {
  schemaVersion: 3;
  task: string;
  scope: string;
  capturedAt: string;
  activeConstraints: RetainedReference[];
}

export type Handoff = LegacyHandoff | ContentHandoff | RetainedHandoff;

export interface FieldChange {
  field: keyof Constraint;
  before: string | number | null;
  after: string | number | null;
}

export type RuleFindingCode =
  | "MISSING"
  | "EXPIRED"
  | "REVOKED"
  | "SUPERSEDED"
  | "OUT_OF_SCOPE"
  | "UNKNOWN"
  | "CHANGED";

export type FindingCode = RuleFindingCode | "NO_ACTIVE_CONSTRAINTS";

export interface RuleFinding {
  code: RuleFindingCode;
  id: string;
  message: string;
  expected?: { revision: number; contentHash: string };
  reported?: { revision: number; contentHash: string };
  changes?: FieldChange[];
}

export interface EmptyPolicyFinding {
  code: "NO_ACTIVE_CONSTRAINTS";
  message: string;
  id?: never;
  expected?: never;
  reported?: never;
}

export type Finding = RuleFinding | EmptyPolicyFinding;

export interface VerificationResult {
  schemaVersion: 1 | 2 | 3;
  tracking?: "content";
  activeConstraintCount?: number;
  status: "verified" | "mismatch";
  scope: string;
  asOf: string;
  expectedConstraints: string[];
  reportedConstraints: string[];
  findings: Finding[];
}

export interface Explanation {
  schemaVersion: 1;
  scope: string;
  asOf: string;
  activeConstraintCount: number;
  rules: {
    id: string;
    scope: string;
    description: string;
    source: string;
    decision: "ACTIVE" | "OUT_OF_SCOPE" | "REVOKED" | "SUPERSEDED" | "EXPIRED";
    reason: string;
  }[];
}
