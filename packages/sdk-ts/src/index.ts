/**
 * ProofMeta TypeScript SDK — scaffold.
 * Validate manifests/requests, call provider endpoints, helpers: TBD.
 */

export const PROOFMETA_PROTOCOL_VERSION = "1.0" as const;

export type ProofMetaStatus =
  | "OPEN"
  | "PENDING"
  | "GRANTED"
  | "DENIED"
  | "REVOKED";
