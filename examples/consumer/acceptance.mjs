// Copyright 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)
// SPDX-License-Identifier: Apache-2.0
import { acceptProtocolInput, parseProtocolJson } from '@proofmeta/sdk-ts/acceptance';

/** Raw HTTP wrapper ingress; protocol/context decisions belong to the SDK. */
export function acceptConsumerResponse(bytes, context) {
  const wrapper = parseProtocolJson(bytes);
  if (!wrapper || typeof wrapper !== 'object' || Array.isArray(wrapper) || !Array.isArray(wrapper.chain)) {
    throw new TypeError('server returned unexpected chain wrapper shape');
  }
  return acceptProtocolInput({ kind: 'value', value: wrapper.chain }, context);
}
