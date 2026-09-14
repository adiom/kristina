import { createHash } from 'crypto';

jest.mock('ai', () => ({
  __esModule: true,
  ToolLoopAgent: class {
    async generate({ prompt }: { prompt: string }) {
      generatedPrompts.push(prompt);
      return { text: `echo: ${prompt.slice(0, 20)}` };
    }
  },
  embed: jest.fn(async () => ({ embedding: new Array(768).fill(0) })),
  tool: (definition: unknown) => definition,
}));

const generatedPrompts: string[] = [];

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
  upsertVaultProfile: jest.fn(async () => undefined),
  completeVaultOnboarding: jest.fn(async () => {}),
  registerAttachmentsAsVaultItems: jest.fn(async () => []),
}));

import * as store from '../../memory/store';
import * as vault from '../../vault';
import { processAgent } from '../core';
import type { AgentContext, AgentUserProfile } from '../types';

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
    generatedPrompts.length = 0;
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

  it('bootstraps an Orbital profile and retrieves it before generating a response', async () => {
    const profile: AgentUserProfile = {
      completed: true,
      name: 'Мария',
      role: 'Орбитальный инженер',
      interests: 'Плазменные двигатели',
      goals: 'Собрать карту технологий',
      context: 'Работает в Orbital',
      completedAt: '2026-09-14T10:00:00.000Z',
    };
    const storedProfile = {
      id: 'profile-1',
      summary: 'Профиль пользователя из Orbital:\n- Имя: Мария\n- Роль: Орбитальный инженер',
      metadata: { source: 'orbital' },
    };
    jest
      .mocked(vault.getVaultProfile)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(storedProfile as never);

    const result = await processAgent('расскажи про мою текущую роль', {
      ...baseContext,
      userId: 'user-42',
      userProfile: profile,
      memoryAccess: { ...baseContext.memoryAccess, user: true, write: true },
    });

    expect(vault.upsertVaultProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        vaultId: 'vault-1',
        title: 'Orbital onboarding',
        createdByUserId: 'user-42',
      }),
    );
    expect(generatedPrompts[0]).toContain('Орбитальный инженер');
    expect(result.sources?.[0]).toEqual(
      expect.objectContaining({
        id: 'profile-1',
        source: 'user',
        sourceType: 'onboarding',
      }),
    );
    expect(result.metadata?.profileBootstrap).toBe('stored');
  });

  it('does not rewrite an unchanged Orbital profile', async () => {
    const profile: AgentUserProfile = {
      completed: true,
      name: 'Мария',
      role: 'Орбитальный инженер',
    };
    const profileHash = createHash('sha256')
      .update(JSON.stringify(profile))
      .digest('hex');
    jest.mocked(vault.getVaultProfile).mockResolvedValue({
      id: 'profile-1',
      summary: 'Профиль пользователя из Orbital',
      metadata: { profileHash },
    } as never);

    const result = await processAgent('расскажи про мою текущую роль', {
      ...baseContext,
      userId: 'user-42',
      userProfile: profile,
      memoryAccess: { ...baseContext.memoryAccess, user: true, write: true },
    });

    expect(vault.upsertVaultProfile).not.toHaveBeenCalled();
    expect(result.metadata?.profileBootstrap).toBe('unchanged');
  });

  it('updates an Orbital profile when its hash changes', async () => {
    jest.mocked(vault.getVaultProfile).mockResolvedValue({
      id: 'profile-1',
      summary: 'Старый профиль',
      metadata: { profileHash: 'old-hash' },
    } as never);

    const result = await processAgent('расскажи про мою текущую роль', {
      ...baseContext,
      userId: 'user-42',
      userProfile: {
        completed: true,
        name: 'Мария',
        role: 'Инженер-исследователь',
      },
      memoryAccess: { ...baseContext.memoryAccess, user: true, write: true },
    });

    expect(vault.upsertVaultProfile).toHaveBeenCalledTimes(1);
    expect(result.metadata?.profileBootstrap).toBe('updated');
  });

  it('does not bootstrap a profile without memory write access', async () => {
    await processAgent('что ты знаешь обо мне?', {
      ...baseContext,
      userId: 'user-42',
      userProfile: { completed: true, name: 'Мария' },
      memoryAccess: { ...baseContext.memoryAccess, user: true, write: false },
    });

    expect(vault.upsertVaultProfile).not.toHaveBeenCalled();
  });

  it('keeps memory lookups isolated between local users', async () => {
    jest
      .mocked(vault.resolveUserVault)
      .mockResolvedValueOnce({
        vaultId: 'vault-user-a',
        globalUserId: 'test-svc:user-a',
        isNewVault: false,
        onboardingStatus: 'completed',
      })
      .mockResolvedValueOnce({
        vaultId: 'vault-user-b',
        globalUserId: 'test-svc:user-b',
        isNewVault: false,
        onboardingStatus: 'completed',
      });

    await processAgent('что ты знаешь обо мне?', {
      ...baseContext,
      userId: 'user-a',
      memoryAccess: { ...baseContext.memoryAccess, user: true },
    });
    await processAgent('что ты знаешь обо мне?', {
      ...baseContext,
      userId: 'user-b',
      memoryAccess: { ...baseContext.memoryAccess, user: true },
    });

    expect(store.searchVaultMemory).toHaveBeenNthCalledWith(
      1,
      'vault-user-a',
      'что ты знаешь обо мне?',
      expect.anything(),
    );
    expect(store.searchVaultMemory).toHaveBeenNthCalledWith(
      2,
      'vault-user-a',
      'что ты знаешь обо мне?',
      expect.anything(),
    );
    expect(store.searchVaultMemory).toHaveBeenNthCalledWith(
      3,
      'vault-user-b',
      'что ты знаешь обо мне?',
      expect.anything(),
    );
    expect(store.searchVaultMemory).toHaveBeenNthCalledWith(
      4,
      'vault-user-b',
      'что ты знаешь обо мне?',
      expect.anything(),
    );
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

  it('returns accessible memory directly for a memory status request', async () => {
    jest.mocked(store.searchOwnMemory).mockResolvedValueOnce([
      {
        id: 'memory-1',
        content: 'Canfly: внутренний проект с фокусом на AI-экономику',
        category: 'knowledge',
        importance: 8,
        similarity: 0.92,
        sourceType: 'auto',
      },
    ] as never);

    const result = await processAgent('что ты знаешь про Canfly?', {
      ...baseContext,
      userId: 'user-42',
    });

    expect(store.searchOwnMemory).toHaveBeenCalledWith(
      'что ты знаешь про Canfly?',
      { limit: 5 },
    );
    expect(result.text).toContain('Вот что мне сейчас доступно в памяти');
    expect(result.text).toContain('[своя] Canfly: внутренний проект');
    expect(result.sources?.[0]).toEqual(
      expect.objectContaining({ source: 'own', sourceType: 'auto' }),
    );
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
