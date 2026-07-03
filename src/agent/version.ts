/**
 * Agent runtime versioning.
 *
 * Bump {@link PROTOCOL_VERSION} whenever the {@link AgentContext} or
 * {@link AgentResult} contract changes in a way that is not backwards
 * compatible.  External services can use {@link SUPPORTED_SOURCES} and
 * {@link CAPABILITIES} to negotiate what the agent can do.
 */

export const PROTOCOL_VERSION = '1.0.0';

export const SUPPORTED_SOURCES = ['sfera', 'http', 'ws', 'sim'] as const;

export const CAPABILITIES = {
  /** Agent can search its memory. */
  memorySearch: true,
  /** Agent can persist new memory entries. */
  memoryWrite: true,
  /** Agent can run scheduled reflection cycles. */
  reflection: true,
  /** Agent can evolve interest scores. */
  interests: true,
  /** Agent returns structured results (text + type + sources). */
  structuredResult: true,
} as const;

export function getAgentInfo() {
  return {
    version: PROTOCOL_VERSION,
    sources: SUPPORTED_SOURCES,
    capabilities: CAPABILITIES,
  };
}
