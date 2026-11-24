export interface Constraint {
  id: string;
  scope: string;
  description: string;
  source: string;
  expiresAt?: string;
  revokedAt?: string;
  replacedBy?: string;
  supersededAt?: string;
}

export interface Manifest {
  schemaVersion: 1;
  constraints: Constraint[];
}

export interface Handoff {
  schemaVersion: 1;
  task: string;
  activeConstraints: string[];
}

export type FindingCode =
  | "MISSING"
  | "EXPIRED"
  | "REVOKED"
  | "SUPERSEDED"
  | "OUT_OF_SCOPE"
  | "UNKNOWN";

export interface Finding {
  code: FindingCode;
  id: string;
  message: string;
}

export interface VerificationResult {
  schemaVersion: 1;
  status: "verified" | "mismatch";
  scope: string;
  asOf: string;
  expectedConstraints: string[];
  reportedConstraints: string[];
  findings: Finding[];
}
