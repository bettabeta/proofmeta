// Copyright 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)
// SPDX-License-Identifier: Apache-2.0
// One table for value/raw SDK ingress and the upcoming CLI adapter.
export const scopeCases = [
  ...['commercial','non-commercial','derivative-allowed','attribution-required','ai-training-allowed','ai-training-excluded','sublicense-allowed','revocable'].map(tag => ({ name: tag, scope: [tag], code: null })),
  ...['https://EXAMPLE.test:443/a/../b','http://example.test/scope','urn:example:scope','mailto:scope@example.test','custom:opaque','custom://example.test/scope','https:example.test','https://example.test/a b'].map(url => ({ name: url, scope: ['commercial',url], code: null })),
  { name: 'independent-training', scope: ['commercial','ai-training-excluded'], code: null },
  { name: 'URL-only', scope: ['https://example.test/scope'], code: 'SCOPE_INVALID' },
  { name: 'garbage', scope: ['garbage'], code: 'SCOPE_INVALID', entry: 0 },
  ...['unknown','commercial-use','/relative','//example.test/scope','../relative',' https://example.test','https://example.test ','\u00a0https://example.test','https://example.test\ufeff','https://exa\tmple.test','https://example.test/\n','urn:exa\rmple','custom:a\u0000b','custom:a\u007fb','custom:a\u0085b'].map(url => ({ name: JSON.stringify(url), scope: ['commercial',url], code: 'SCOPE_INVALID', entry: 1 })),
  { name: 'commercial-conflict', scope: ['commercial','non-commercial'], code: 'SCOPE_INVALID', entry: 1 },
  { name: 'training-conflict', scope: ['ai-training-excluded','ai-training-allowed'], code: 'SCOPE_INVALID', entry: 1 },
  { name: 'empty-schema-first', scope: [], code: 'SCHEMA_INVALID' },
  { name: 'number-schema-first', scope: ['commercial',3], code: 'SCHEMA_INVALID', entry: 1 },
  { name: 'null-schema-first', scope: null, code: 'SCHEMA_INVALID' },
  { name: 'object-schema-first', scope: {}, code: 'SCHEMA_INVALID' },
  { name: 'string-schema-first', scope: 'commercial', code: 'SCHEMA_INVALID' },
];
