// Copyright 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)
// SPDX-License-Identifier: Apache-2.0
import type { VerifyOptions } from './envelope.js';
import type { JsonIngressCode, JsonValue } from './json-ingress.js';
export type AcceptanceSource = { kind: 'bytes'; bytes: Uint8Array } | { kind: 'value'; value: unknown };
export type AcceptanceOperation = 'manifest' | 'provider-open' | 'license-chain' | 'attestation-root' | 'attestation-chain' | 'inspect-envelope';
export type AcceptanceContext = VerifyOptions & (
  | { operation: 'manifest' | 'attestation-root' | 'attestation-chain'; purpose: 'protocol-conformance' }
  | { operation: 'provider-open'; purpose: 'protocol-conformance'; expectedProvider: string }
  | { operation: 'license-chain'; purpose: 'protocol-conformance' }
  | { operation: 'license-chain'; purpose: 'consumer-response'; sentOpen: unknown; expectedProvider: string; manifest: unknown; item: unknown; licenseType: string; termsHash: string }
  | { operation: 'inspect-envelope'; purpose: 'inspection' }
);
export type CheckStatus = 'pass' | 'fail' | 'not-checked' | 'not-applicable';
export type AcceptanceCheck = 'ingress' | 'schema' | 'hash' | 'signature' | 'authority' | 'context' | 'policy';
export type AcceptanceCode = JsonIngressCode | 'SCHEMA_INVALID' | 'HASH_MISMATCH' | 'SIGNATURE_INVALID' | 'AUTHORITY_MISMATCH' | 'CONTEXT_REQUIRED' | 'CONTEXT_MISMATCH' | 'MODE_INVALID' | 'SCOPE_INVALID' | 'PAYLOAD_UNSUPPORTED' | 'ROOT_INVALID' | 'PARENT_MISMATCH' | 'REQUEST_MISMATCH' | 'TRANSITION_INVALID';
export interface AcceptanceError { code: AcceptanceCode; path: string; index?: number; position?: number; }
export type AcceptanceReport = AcceptanceReportFields & (
  | { operation: 'inspect-envelope'; purpose: 'inspection'; accepted: false }
  | { operation: 'license-chain'; purpose: 'protocol-conformance' | 'consumer-response'; accepted: boolean }
  | { operation: Exclude<AcceptanceOperation, 'inspect-envelope' | 'license-chain'>; purpose: 'protocol-conformance'; accepted: boolean }
);
export interface AcceptanceReportFields {
  reportVersion: 1;
  checks: Record<AcceptanceCheck, CheckStatus>;
  ingress: { kind: AcceptanceSource['kind']; rawEncoding: CheckStatus; duplicateKeys: CheckStatus };
  errors: AcceptanceError[];
  /** Frozen detached content checked by this invocation; absent on ingress failure. */
  snapshot?: JsonValue;
  exclusions: { policyScope: 'unresolved-excluded'; manifestScope: CheckStatus };
  guarantees: { anchors: 'not-checked'; trustedTime: 'not-checked'; operationalAuthorization: false };
}
