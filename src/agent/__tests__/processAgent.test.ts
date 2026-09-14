jest.mock('ai', () => ({
  __esModule: true,
  ToolLoopAgent: class {
    async generate({ prompt }: { prompt: string }) {
      return { text: `echo: ${prompt.slice(0, 20)}` };
    }
  },
  embed: jest.fn(async () => ({ embedding: new Array(768).fill(0) })),
  tool: (definition: unknown) => definition,
}));

jest.mock('@ai-sdk/openai-compatible', () => {
  const callable = Object.assign((modelId: string) => ({ modelId }), {
    embeddingModel: () => ({}),
  });
  return { createOpenAICompatible: () => callable };
});

jest.mock('@ai-sdk/groq', () => {
  const callable = (modelId: string) => ({ modelId });
  return { createGroq: () => callable };
});

jest.mock('../../memory/store', () => ({
  searchOwnMemory: jest.fn(async () => []),
  searchVaultMemory: jest.fn(async () => []),
  searchSpaceMemory: jest.fn(async () => []),
  searchServiceMemory: jest.fn(async () => []),
  storeOwnMemory: jest.fn(async () => {}),
  storeSpaceMemory: jest.fn(async () => {}),
  storeServiceMemory: jest.fn(async () => {}),
  upsertVaultMemory: jest.fn(async () => ({ stored: true, memoryId: 'memory-1' })),
  listVaultMemories: jest.fn(async () => []),
  forgetVaultMemory: jest.fn(async () => ({ forgotten: 1, memoryIds: ['memory-1'] })),
}));

jest.mock('../../transparency', () => ({
  logActivity: jest.fn(async () => {}),
}));

jest.mock('../../vault', () => ({
  resolveUserVault: jest.fn(
    async (serviceId: string, userId: string, options: unknown) => ({
      vaultId: 'vault-1',
      globalUserId: `${serviceId}:${userId}`,
      isNewVault: false,
      onboardingStatus: 'completed',
      options,
    }),
  ),
  upsertIdentityLinks: jest.fn(async () => {}),
  getVaultProfile: jest.fn(async () => undefined),
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

  it('rejects an invalid context', async () => {
    await expect(
      // @ts-expect-error runtime validation
      processAgent('hello', { serviceId: 'x' }),
    ).rejects.toThrow();
  });

  it('does not persist memory when write is false', async () => {
    await processAgent('remember me', baseContext);
    expect(store.upsertVaultMemory).not.toHaveBeenCalled();
    expect(store.storeOwnMemory).not.toHaveBeenCalled();
    expect(store.storeSpaceMemory).not.toHaveBeenCalled();
    expect(store.storeServiceMemory).not.toHaveBeenCalled();
  });

  it('resolves a vault from serviceId and local userId', async () => {
    const result = await processAgent('hello', {
      ...baseContext,
      userId: 'user-42',
      userName: 'Alice',
    });

    expect(vault.resolveUserVault).toHaveBeenCalledWith('test-svc', 'user-42', {
      displayName: 'Alice',
      serviceId: 'test-svc',
      spaceId: 'space-1',
    });
    expect(result.metadata?.vaultId).toBe('vault-1');
  });

  it('persists the current identity but ignores untrusted extra links', async () => {
    await processAgent('привет', {
      ...baseContext,
      serviceId: 'telegram',
      userId: 'tg-user-42',
      identityLinks: [
        { serviceId: 'telegram', userId: 'tg-user-42', primary: true },
        { serviceId: 'sfera', userId: 'sfera-user-7' },
      ],
    });

    expect(vault.upsertIdentityLinks).toHaveBeenCalledWith('vault-1', [
      {
        serviceId: 'telegram',
        userId: 'tg-user-42',
        primary: true,
      },
    ]);
  });

  it('persists trusted identity links only when runtime trust is set', async () => {
    await processAgent('привет', {
      ...baseContext,
      userId: 'tg-user-42',
      identityLinks: [{ serviceId: 'sfera', userId: 'sfera-user-7' }],
      runtimeTrust: { allowIdentityLinks: true },
    });

    expect(vault.upsertIdentityLinks).toHaveBeenCalledWith(
      'vault-1',
      expect.arrayContaining([
        expect.objectContaining({ serviceId: 'sfera', userId: 'sfera-user-7' }),
      ]),
    );
  });

  it('searches user memory by vault and reads facts plus episodes', async () => {
    jest.mocked(store.searchVaultMemory).mockResolvedValueOnce([
      {
        id: 'fact-1',
        content: 'Пользователь изучает рынки',
        category: 'knowledge',
        importance: 8,
        similarity: 0.9,
        source: 'user',
      },
    ] as never);

    const result = await processAgent('чем я занимаюсь?', {
      ...baseContext,
      userId: 'user-42',
      memoryAccess: { ...baseContext.memoryAccess, user: true },
    });

    expect(store.searchVaultMemory).toHaveBeenCalledWith(
      'vault-1',
      'чем я занимаюсь?',
      expect.objectContaining({ memoryTypes: ['fact', 'summary'] }),
    );
    expect(store.searchVaultMemory).toHaveBeenCalledWith(
      'vault-1',
      'чем я занимаюсь?',
      expect.objectContaining({ memoryTypes: ['episode'] }),
    );
    expect(result.sources?.[0].id).toBe('fact-1');
  });

  it('does not automatically save an onboarding answer without a durable fact', async () => {
    jest.mocked(vault.resolveUserVault).mockResolvedValueOnce({
      vaultId: 'vault-pending',
      globalUserId: 'test-svc:user-42',
      isNewVault: false,
      onboardingStatus: 'pending',
    });

    await processAgent('я занимаюсь исследованием рынков', {
      ...baseContext,
      userId: 'user-42',
      memoryAccess: { ...baseContext.memoryAccess, user: true, write: true },
    });

    expect(store.upsertVaultMemory).not.toHaveBeenCalled();
    expect(vault.completeVaultOnboarding).not.toHaveBeenCalled();
  });

  it('handles a natural forget command through vault memory', async () => {
    const result = await processAgent('забудь, что я люблю кофе', {
      ...baseContext,
      userId: 'user-42',
      memoryAccess: { ...baseContext.memoryAccess, user: true, write: true },
    });

    expect(store.forgetVaultMemory).toHaveBeenCalledWith(
      'vault-1',
      'я люблю кофе',
      { exact: false },
    );
    expect(result.metadata?.memoryOperation).toEqual({
      type: 'forget',
      forgotten: 1,
      memoryIds: ['memory-1'],
    });
  });

  it('returns active personal memory for a status request', async () => {
    jest.mocked(store.listVaultMemories).mockResolvedValueOnce([
      { id: 'memory-1', content: 'Пользователь любит кофе', category: 'knowledge', importance: 8 },
    ] as never);

    const result = await processAgent('что ты обо мне помнишь?', {
      ...baseContext,
      userId: 'user-42',
      memoryAccess: { ...baseContext.memoryAccess, user: true },
    });

    expect(store.listVaultMemories).toHaveBeenCalledWith('vault-1', { limit: 50 });
    expect(result.text).toContain('Пользователь любит кофе');
  });

  it('registers attachments in the resolved vault', async () => {
    const result = await processAgent('посмотри файл', {
      ...baseContext,
      userId: 'user-42',
      attachments: [
        {
          type: 'document',
          source: 'storage',
          title: 'contract.pdf',
          storageKey: 'vaults/user-42/contract.pdf',
        },
      ],
    });

    expect(vault.registerAttachmentsAsVaultItems).toHaveBeenCalledWith(
      'vault-1',
      [expect.objectContaining({ title: 'contract.pdf' })],
      'user-42',
    );
    expect(result.metadata?.attachments).toEqual([
      {
        type: 'document',
        title: 'contract.pdf',
        storageKey: 'vaults/user-42/contract.pdf',
        url: undefined,
      },
    ]);
  });

  it('appends the onboarding question for a new vault', async () => {
    jest.mocked(vault.resolveUserVault).mockResolvedValueOnce({
      vaultId: 'vault-new',
      globalUserId: 'test-svc:user-42',
      isNewVault: true,
      onboardingStatus: 'pending',
    });

    const result = await processAgent('Поздоровайся и расскажи о себе', {
      ...baseContext,
      userId: 'user-42',
    });

    expect(result.text).toContain('чем ты сейчас занимаешься');
    expect(result.text).toContain('что для тебя правда важно?');
  });
});
