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

jest.mock('../../vault', () => ({
  ensureUserVault: jest.fn(async (globalUserId: string) => ({
    vaultId: 'vault-1',
    globalUserId,
    isNewVault: false,
    onboardingStatus: 'completed',
  })),
  resolveGlobalUserId: jest.fn(
    async (_serviceId: string | undefined, userId: string | undefined) => userId ?? null,
  ),
  upsertIdentityLinks: jest.fn(async () => {}),
  upsertVaultProfile: jest.fn(async () => ({ id: 'profile-1' })),
  completeVaultOnboarding: jest.fn(async () => {}),
  registerAttachmentsAsVaultItems: jest.fn(async () => []),
}));

import * as store from '../../memory/store';
import * as vault from '../../vault';
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

  it('creates or touches a vault when userId is present', async () => {
    const result = await processAgent('hello', {
      ...baseContext,
      userId: 'global-user-1',
      userName: 'Alice',
    });

    expect(vault.ensureUserVault).toHaveBeenCalledWith('global-user-1', {
      displayName: 'Alice',
      serviceId: 'test-svc',
      spaceId: 'space-1',
    });
    expect(result.metadata?.vaultId).toBe('vault-1');
  });

  it('persists the current service user as the primary identity link', async () => {
    await processAgent('привет', {
      ...baseContext,
      serviceId: 'telegram',
      userId: 'tg-user-42',
      userName: 'Alice TG',
    });

    expect(vault.upsertIdentityLinks).toHaveBeenCalledWith('vault-1', [
      {
        serviceId: 'telegram',
        userId: 'tg-user-42',
        userName: 'Alice TG',
        primary: true,
      },
    ]);
  });

  it('writes the first onboarding answer into vault profile (not memory)', async () => {
    jest.mocked(vault.ensureUserVault).mockResolvedValueOnce({
      vaultId: 'vault-pending',
      globalUserId: 'global-user-2',
      isNewVault: false,
      onboardingStatus: 'pending',
    });

    await processAgent('я занимаюсь исследованием рынков', {
      ...baseContext,
      userId: 'global-user-2',
      userName: 'Anya',
      memoryAccess: { ...baseContext.memoryAccess, user: true, write: true },
    });

    expect(vault.upsertVaultProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        vaultId: 'vault-pending',
        title: 'Anya',
        content: 'я занимаюсь исследованием рынков',
        source: 'user',
        tags: ['onboarding'],
      }),
    );
    expect(store.storeUserMemory).not.toHaveBeenCalledWith(
      'global-user-2',
      expect.objectContaining({ content: expect.stringContaining('First profile note') }),
    );
    expect(vault.completeVaultOnboarding).toHaveBeenCalledWith('vault-pending');
  });

  it('skips tiny onboarding answers and does not pollute the profile', async () => {
    jest.mocked(vault.ensureUserVault).mockResolvedValueOnce({
      vaultId: 'vault-pending',
      globalUserId: 'global-user-2b',
      isNewVault: false,
      onboardingStatus: 'pending',
    });

    await processAgent('привет', {
      ...baseContext,
      userId: 'global-user-2b',
      memoryAccess: { ...baseContext.memoryAccess, user: true, write: true },
    });

    expect(vault.upsertVaultProfile).not.toHaveBeenCalled();
    expect(vault.completeVaultOnboarding).not.toHaveBeenCalled();
  });

  it('resolves a cross-service globalUserId via identity links', async () => {
    jest.mocked(vault.resolveGlobalUserId).mockResolvedValueOnce('global-person-9');

    const result = await processAgent('привет', {
      ...baseContext,
      serviceId: 'telegram',
      userId: 'tg-user-42',
    });

    expect(vault.resolveGlobalUserId).toHaveBeenCalledWith('telegram', 'tg-user-42');
    expect(vault.ensureUserVault).toHaveBeenCalledWith(
      'global-person-9',
      expect.objectContaining({ serviceId: 'telegram' }),
    );
    expect(result.metadata?.vaultId).toBe('vault-1');
  });

  it('persists identityLinks sent by the adapter', async () => {
    await processAgent('привет', {
      ...baseContext,
      userId: 'tg-user-42',
      identityLinks: [
        { serviceId: 'telegram', userId: 'tg-user-42', primary: true },
        { serviceId: 'sfera', userId: 'sfera-user-7' },
      ],
    });

    expect(vault.upsertIdentityLinks).toHaveBeenCalledWith(
      'vault-1',
      expect.arrayContaining([
        expect.objectContaining({ serviceId: 'telegram', userId: 'tg-user-42', primary: true }),
        expect.objectContaining({ serviceId: 'sfera', userId: 'sfera-user-7' }),
      ]),
    );
  });

  it('registers attachments in vault and exposes them in metadata', async () => {
    const result = await processAgent('посмотри файл', {
      ...baseContext,
      userId: 'global-user-3',
      attachments: [
        {
          type: 'document',
          source: 'storage',
          title: 'contract.pdf',
          mimeType: 'application/pdf',
          storageKey: 'vaults/global-user-3/contract.pdf',
        },
      ],
    });

    expect(vault.registerAttachmentsAsVaultItems).toHaveBeenCalledWith(
      'vault-1',
      [
        expect.objectContaining({
          type: 'document',
          title: 'contract.pdf',
        }),
      ],
      'global-user-3',
    );
    expect(result.metadata?.attachments).toEqual([
      {
        type: 'document',
        title: 'contract.pdf',
        storageKey: 'vaults/global-user-3/contract.pdf',
        url: undefined,
      },
    ]);
  });

  it('appends onboarding question for new vaults when model ignores it', async () => {
    jest.mocked(vault.ensureUserVault).mockResolvedValueOnce({
      vaultId: 'vault-new',
      globalUserId: 'global-user-4',
      isNewVault: true,
      onboardingStatus: 'pending',
    });

    const result = await processAgent('Поздоровайся и расскажи о себе', {
      ...baseContext,
      userId: 'global-user-4',
    });

    expect(result.text).toContain('чем ты занимаешься');
    expect(result.text).toContain('что для тебя сейчас важно?');
  });
});
