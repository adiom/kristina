/**
 * Smoke tests for `processAgent`.
 *
 * The tests mock the LLM and the memory layer so we can exercise the
 * runtime end‑to‑end without a real database or model server.  They
 * verify the contract that external transports rely on:
 *
 *   - validateContext is called (missing fields throw)
 *   - the result has the expected `AgentResult` shape
 *   - `memoryAccess.write = false` prevents the runtime from persisting
 *     new memory, but the answer is still produced
 *
 * Run with `pnpm test`.
 */

// Mock BEFORE importing the module under test.
jest.mock('ai', () => ({
  __esModule: true,
  ToolLoopAgent: class {
    async generate({ prompt }: { prompt: string }) {
      return { text: `echo: ${prompt.slice(0, 20)}` };
    }
  },
  embed: jest.fn(async () => ({ embedding: new Array(768).fill(0) })),
  tool: (def: any) => def,
}));

jest.mock('@ai-sdk/openai-compatible', () => {
  const callable: any = (modelId: string) => ({ modelId });
  callable.embeddingModel = () => ({});
  return { createOpenAICompatible: () => callable };
});

jest.mock('@ai-sdk/groq', () => {
  const callable: any = (modelId: string) => ({ modelId });
  return { createGroq: () => callable };
});

jest.mock('../../memory/store', () => ({
  searchOwnMemory: jest.fn(async () => []),
  searchUserMemory: jest.fn(async () => []),
  searchSpaceMemory: jest.fn(async () => []),
  searchServiceMemory: jest.fn(async () => []),
  storeOwnMemory: jest.fn(async () => {}),
  storeUserMemory: jest.fn(async () => {}),
  storeSpaceMemory: jest.fn(async () => {}),
  storeServiceMemory: jest.fn(async () => {}),
}));

jest.mock('../../transparency', () => ({
  logActivity: jest.fn(async () => {}),
}));

import * as store from '../../memory/store';
import { processAgent } from '../core';
import type { AgentContext } from '../types';

const baseContext: AgentContext = {
  source: 'http',
  serviceId: 'test-svc',
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

describe('processAgent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns a structured AgentResult', async () => {
    const result = await processAgent('hello world', baseContext);
    expect(result.text).toMatch(/^echo:/);
    expect(result.type).toBe('message');
    expect(result.metadata?.serviceId).toBe('test-svc');
  });

  it('rejects a context that is missing required fields', async () => {
    await expect(
      // @ts-expect-error testing runtime validation
      processAgent('hello', { serviceId: 'x' }),
    ).rejects.toThrow();
  });

  it('does not persist memory when write is false', async () => {
    await processAgent('remember me', baseContext);
    // The runtime only invokes store* when the result actually contains
    // memoryToStore AND write is true.  With write=false the mocks
    // should never have been called.
    expect(store.storeOwnMemory).not.toHaveBeenCalled();
    expect(store.storeUserMemory).not.toHaveBeenCalled();
    expect(store.storeSpaceMemory).not.toHaveBeenCalled();
    expect(store.storeServiceMemory).not.toHaveBeenCalled();
  });
});
