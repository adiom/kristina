/**
 * Unit tests for the policy layer.
 *
 * These tests do not require a database – they exercise the validation
 * and access‑control logic in isolation.
 */

import {
  validateContext,
  canAccessMemory,
  assertWriteAllowed,
  checkRateLimit,
  PolicyError,
  _resetRateLimits,
} from '../index';
import type { AgentContext } from '../../agent/types';

const baseContext: AgentContext = {
  source: 'http',
  serviceId: 'svc',
  spaceId: 'space-1',
  trigger: 'mention',
  responseMode: 'public',
  memoryAccess: {
    own: true,
    user: false,
    space: false,
    service: false,
    write: false,
  },
};

describe('policy.validateContext', () => {
  it('accepts a fully populated context', () => {
    expect(() => validateContext(baseContext)).not.toThrow();
  });

  it('rejects missing source', () => {
    const ctx: any = { ...baseContext, source: undefined };
    expect(() => validateContext(ctx)).toThrow(PolicyError);
  });

  it('rejects missing serviceId', () => {
    const ctx: any = { ...baseContext, serviceId: '' };
    expect(() => validateContext(ctx)).toThrow(PolicyError);
  });

  it('rejects missing memoryAccess', () => {
    const ctx: any = { ...baseContext, memoryAccess: undefined };
    expect(() => validateContext(ctx)).toThrow(PolicyError);
  });
});

describe('policy.canAccessMemory', () => {
  it('respects own flag', () => {
    expect(canAccessMemory(baseContext, 'own')).toBe(true);
    expect(
      canAccessMemory({ ...baseContext, memoryAccess: { ...baseContext.memoryAccess, own: false } }, 'own'),
    ).toBe(false);
  });

  it('respects user flag', () => {
    expect(canAccessMemory(baseContext, 'user')).toBe(false);
    expect(
      canAccessMemory({ ...baseContext, memoryAccess: { ...baseContext.memoryAccess, user: true } }, 'user'),
    ).toBe(true);
  });
});

describe('policy.assertWriteAllowed', () => {
  it('throws when write is false', () => {
    expect(() => assertWriteAllowed(baseContext)).toThrow(PolicyError);
  });

  it('passes when write is true', () => {
    expect(() =>
      assertWriteAllowed({
        ...baseContext,
        memoryAccess: { ...baseContext.memoryAccess, write: true },
      }),
    ).not.toThrow();
  });
});

describe('policy.checkRateLimit', () => {
  beforeEach(() => _resetRateLimits());

  it('throws after the bucket is exhausted', () => {
    // Force a tiny bucket so the test is fast and deterministic.
    const cfg = { capacity: 2, refillPerSecond: 0 };
    expect(() => checkRateLimit('svc', cfg)).not.toThrow();
    expect(() => checkRateLimit('svc', cfg)).not.toThrow();
    expect(() => checkRateLimit('svc', cfg)).toThrow(PolicyError);
  });

  it('does not affect other services', () => {
    const cfg = { capacity: 1, refillPerSecond: 0 };
    checkRateLimit('svc-a', cfg);
    expect(() => checkRateLimit('svc-b', cfg)).not.toThrow();
  });
});
