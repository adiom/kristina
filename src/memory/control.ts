import {
  canAccessMemory,
  assertWriteAllowed,
  validateContext,
  PolicyError,
} from '../policy';
import { resolveUserVault } from '../vault';
import {
  confirmVaultMemory,
  forgetVaultMemory,
  listVaultMemories,
  searchVaultMemory,
} from './store';
import type { AgentContext } from '../agent/types';

async function requireUserVault(context: AgentContext) {
  validateContext(context);
  if (!canAccessMemory(context, 'user') || !context.userId) {
    throw new PolicyError('User memory access is forbidden', 'memory_forbidden');
  }
  return resolveUserVault(context.serviceId, context.userId, {
    displayName: context.userName,
    serviceId: context.serviceId,
    spaceId: context.spaceId,
  });
}

export async function searchMemoryControl(
  query: string,
  context: AgentContext,
  limit = 10,
) {
  const vault = await requireUserVault(context);
  return searchVaultMemory(vault.vaultId, query, { limit });
}

export async function forgetMemoryControl(
  query: string,
  context: AgentContext,
  options: { exact?: boolean } = {},
) {
  const vault = await requireUserVault(context);
  assertWriteAllowed(context);
  return forgetVaultMemory(vault.vaultId, query, options);
}

export async function confirmMemoryControl(
  target: { memoryId?: string; query?: string },
  context: AgentContext,
) {
  const vault = await requireUserVault(context);
  assertWriteAllowed(context);
  return confirmVaultMemory(vault.vaultId, target);
}

export async function memoryStatusControl(context: AgentContext) {
  const vault = await requireUserVault(context);
  return listVaultMemories(vault.vaultId, { limit: 100 });
}
