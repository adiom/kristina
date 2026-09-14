jest.mock('../../db', () => ({ db: {} }));
jest.mock('ai', () => ({
  embed: jest.fn(async () => ({ embedding: new Array(768).fill(0) })),
}));
jest.mock('@ai-sdk/openai-compatible', () => {
  const callable = Object.assign(() => ({}), {
    embeddingModel: () => ({}),
  });
  return { createOpenAICompatible: () => callable };
});

import {
  resolveDuplicateAction,
  searchUserMemory,
  storeUserMemory,
  upsertVaultMemory,
} from '../store';

describe('memory store lifecycle', () => {
  it('requires a vault for user memory writes and reads', async () => {
    await expect(
      storeUserMemory('user-1', { content: 'Пользователь любит кофе' }),
    ).rejects.toThrow('User memory requires vaultId');
    await expect(searchUserMemory('user-1', 'кофе')).rejects.toThrow(
      'User memory search requires vaultId',
    );
  });

  it('rejects secrets before persistence', async () => {
    await expect(
      upsertVaultMemory('vault-1', {
        content: 'password=super-secret',
        vaultId: 'vault-1',
      }),
    ).rejects.toThrow('contains potential secret');
  });

  it('confirms near-identical memories', () => {
    expect(
      resolveDuplicateAction({ similarity: 0.97, confidence: 70 }, 80),
    ).toBe('confirm');
  });

  it('supersedes a similar memory when the new fact is not weaker', () => {
    expect(
      resolveDuplicateAction({ similarity: 0.88, confidence: 60 }, 75),
    ).toBe('supersede');
  });

  it('creates a separate memory when the new fact is weaker', () => {
    expect(
      resolveDuplicateAction({ similarity: 0.88, confidence: 90 }, 60),
    ).toBe('create');
  });
});
