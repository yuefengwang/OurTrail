import { createHash } from 'node:crypto';
import type { State } from '../src/domain/model';
import type { Command, Payload, Result, Context, ParticipantInput } from '../src/domain/contracts';
import { canonicalPayload } from '../src/domain/contracts';
import { reduceCommand } from '../src/domain/commands';

export const NOW = '2026-09-24T07:00:00+08:00';
let sequence = 0;
export const context: Context = {
  now: NOW,
  id: (kind) => `${kind}-test-${++sequence}`,
};

export function must<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

export function makeCommand(
  state: State,
  payload: Payload,
  userId: string | null = 'u-owner',
  overrides: Partial<Command> = {},
): Command {
  return {
    actor: { userId },
    requestId: `request-${++sequence}`,
    expectedRevision: state.revision,
    fingerprint: createHash('sha256').update(canonicalPayload(payload)).digest('hex'),
    payload,
    ...overrides,
  };
}

export function apply(state: State, payload: Payload, userId = 'u-owner'): State {
  return must(reduceCommand(state, makeCommand(state, payload, userId), context)).state;
}

export function inputFor(state: State, userId: string): ParticipantInput {
  const profile = state.profiles.find((item) => item.id === userId);
  if (!profile) throw new Error(`Missing fixture ${userId}`);
  return {
    personRef: { kind: 'user', userId },
    participant: structuredClone(profile.person),
    trip: { mode: 'shared', pickupPointId: 'p-xipu' },
    consent: { dataUse: true, proxyAuthority: false, proxyHome: false },
  };
}
