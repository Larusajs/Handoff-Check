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

export type Handoff = LegacyHandoff | ContentHandoff;

export type FindingCode =
  | "MISSING"
  | "EXPIRED"
  | "REVOKED"
  | "SUPERSEDED"
  | "OUT_OF_SCOPE"
  | "UNKNOWN"
  | "CHANGED";

export interface Finding {
  code: FindingCode;
  id: string;
  message: string;
  expected?: { revision: number; contentHash: string };
  reported?: { revision: number; contentHash: string };
}

export interface VerificationResult {
  schemaVersion: 1 | 2;
  tracking?: "content";
  status: "verified" | "mismatch";
  scope: string;
  asOf: string;
  expectedConstraints: string[];
  reportedConstraints: string[];
  findings: Finding[];
}
