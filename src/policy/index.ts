/**
 * Policy layer for the cf-kristina agent runtime.
 *
 * Responsibilities:
 *  - Validate that an {@link AgentContext} carries the minimum required
 *    information before it reaches the agent core.
 *  - Decide whether the agent is allowed to read a given memory namespace
 *    (own / user / space / service) for the current request.
 *  - Enforce write permissions – some services (e.g. simulations) may call
 *    the agent with `memoryAccess.write = false` to keep the agent
 *    read‑only.
 *  - Provide a lightweight per‑service rate limiter so a misbehaving
 *    adapter cannot flood the runtime.
 *
 * The policy layer is deliberately *transport‑agnostic*: HTTP, MCP and
 * WebSocket callers all funnel through the same checks.
 */

import type {
  AgentContext,
  AgentNamespace,
} from '../agent/types';

export class PolicyError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'PolicyError';
  }
}

/** Minimum set of fields a context must contain to be processable. */
export function validateContext(ctx: AgentContext): void {
  if (!ctx) {
    throw new PolicyError('Missing context', 'missing_context');
  }
  if (!ctx.source) {
    throw new PolicyError('Context.source is required', 'missing_source');
  }
  if (!ctx.serviceId) {
    throw new PolicyError('Context.serviceId is required', 'missing_service');
  }
  if (!ctx.spaceId) {
    throw new PolicyError('Context.spaceId is required', 'missing_space');
  }
  if (!ctx.memoryAccess) {
    throw new PolicyError('Context.memoryAccess is required', 'missing_access');
  }
  if (!ctx.trigger) {
    throw new PolicyError('Context.trigger is required', 'missing_trigger');
  }
  if (!ctx.responseMode) {
    throw new PolicyError('Context.responseMode is required', 'missing_mode');
  }
}

const ACCESS_FLAG: Record<AgentNamespace, keyof AgentContext['memoryAccess']> = {
  own: 'own',
  user: 'user',
  space: 'space',
  service: 'service',
};

export function canAccessMemory(
  ctx: AgentContext,
  namespace: AgentNamespace,
): boolean {
  return Boolean(ctx.memoryAccess[ACCESS_FLAG[namespace]]);
}

export function assertWriteAllowed(ctx: AgentContext): void {
  if (!ctx.memoryAccess.write) {
    throw new PolicyError(
      `Memory writes are disabled for service "${ctx.serviceId}" in this context`,
      'write_forbidden',
    );
  }
}

/* ------------------------------------------------------------------ */
/* In‑memory rate limiter                                              */
/* ------------------------------------------------------------------ */

interface Bucket {
  tokens: number;
  lastRefill: number;
}

interface RateLimitConfig {
  /** Maximum burst size (tokens). */
  capacity: number;
  /** Tokens added per second. */
  refillPerSecond: number;
}

const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  capacity: 30,
  refillPerSecond: 5,
};

const buckets = new Map<string, Bucket>();

export function checkRateLimit(
  serviceId: string,
  config: RateLimitConfig = DEFAULT_RATE_LIMIT,
): void {
  const now = Date.now();
  const bucket = buckets.get(serviceId) ?? {
    tokens: config.capacity,
    lastRefill: now,
  };

  // Refill
  const elapsed = (now - bucket.lastRefill) / 1000;
  bucket.tokens = Math.min(
    config.capacity,
    bucket.tokens + elapsed * config.refillPerSecond,
  );
  bucket.lastRefill = now;

  if (bucket.tokens < 1) {
    buckets.set(serviceId, bucket);
    throw new PolicyError(
      `Rate limit exceeded for service "${serviceId}"`,
      'rate_limited',
    );
  }

  bucket.tokens -= 1;
  buckets.set(serviceId, bucket);
}

/** Test helper – clears all rate‑limit buckets. */
export function _resetRateLimits() {
  buckets.clear();
}
