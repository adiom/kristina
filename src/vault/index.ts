import { desc, eq } from 'drizzle-orm';
import { db } from '../db';
import { vaultEvents, vaultItems, vaults } from '../db/schema';
import type { AgentAttachment } from '../agent/types';

export interface UserVaultSession {
  vaultId: string;
  globalUserId: string;
  isNewVault: boolean;
  onboardingStatus: 'pending' | 'completed';
}

interface EnsureUserVaultOptions {
  displayName?: string;
  serviceId?: string;
  spaceId?: string;
}

export async function ensureUserVault(
  globalUserId: string,
  options: EnsureUserVaultOptions = {},
): Promise<UserVaultSession> {
  const existing = await db.query.vaults.findFirst({
    where: eq(vaults.globalUserId, globalUserId),
  });

  if (existing) {
    await db
      .update(vaults)
      .set({
        displayName: options.displayName ?? existing.displayName,
        updatedAt: new Date(),
        lastSeenAt: new Date(),
      })
      .where(eq(vaults.id, existing.id));

    return {
      vaultId: existing.id,
      globalUserId: existing.globalUserId,
      isNewVault: false,
      onboardingStatus: existing.onboardingStatus as 'pending' | 'completed',
    };
  }

  const [created] = await db
    .insert(vaults)
    .values({
      globalUserId,
      displayName: options.displayName,
      lastSeenAt: new Date(),
    })
    .returning();

  if (!created) {
    throw new Error(`Failed to create vault for user ${globalUserId}`);
  }

  await db.insert(vaultEvents).values({
    vaultId: created.id,
    type: 'vault_created',
    actorType: 'system',
    actorId: options.serviceId,
    details: {
      globalUserId,
      serviceId: options.serviceId,
      spaceId: options.spaceId,
    },
  });

  return {
    vaultId: created.id,
    globalUserId: created.globalUserId,
    isNewVault: true,
    onboardingStatus: created.onboardingStatus as 'pending' | 'completed',
  };
}

export async function completeVaultOnboarding(vaultId: string): Promise<void> {
  await db
    .update(vaults)
    .set({ onboardingStatus: 'completed', updatedAt: new Date() })
    .where(eq(vaults.id, vaultId));

  await db.insert(vaultEvents).values({
    vaultId,
    type: 'onboarding_completed',
    actorType: 'system',
  });
}

export interface CreateVaultItemInput {
  vaultId: string;
  kind: 'memory' | 'user_file' | 'agent_file' | 'note' | 'profile' | 'artifact';
  title: string;
  summary?: string;
  mimeType?: string;
  sizeBytes?: number;
  storageKey?: string;
  sha256?: string;
  source: 'user' | 'agent' | 'system';
  createdByUserId?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export async function createVaultItem(input: CreateVaultItemInput) {
  const [item] = await db
    .insert(vaultItems)
    .values({
      vaultId: input.vaultId,
      kind: input.kind,
      title: input.title,
      summary: input.summary,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      storageKey: input.storageKey,
      sha256: input.sha256,
      source: input.source,
      createdByUserId: input.createdByUserId,
      tags: input.tags ?? [],
      metadata: input.metadata ?? {},
    })
    .returning();

  if (!item) {
    throw new Error(`Failed to create vault item for vault ${input.vaultId}`);
  }

  await db.insert(vaultEvents).values({
    vaultId: input.vaultId,
    itemId: item.id,
    type: 'item_created',
    actorType: input.source,
    actorId: input.createdByUserId,
    details: {
      kind: input.kind,
      title: input.title,
      storageKey: input.storageKey,
    },
  });

  return item;
}

export async function listVaultItems(vaultId: string) {
  return db.query.vaultItems.findMany({
    where: eq(vaultItems.vaultId, vaultId),
    orderBy: [desc(vaultItems.createdAt)],
  });
}

export async function registerAttachmentsAsVaultItems(
  vaultId: string,
  attachments: AgentAttachment[],
  userId?: string,
) {
  const items = [];

  for (const attachment of attachments) {
    const kind =
      attachment.type === 'artifact'
        ? 'artifact'
        : attachment.type === 'image' || attachment.type === 'file' || attachment.type === 'document'
          ? 'user_file'
          : 'note';

    const item = await createVaultItem({
      vaultId,
      kind,
      title: attachment.title,
      summary: attachment.metadata?.summary as string | undefined,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      storageKey: attachment.storageKey ?? attachment.url,
      sha256: attachment.sha256,
      source: attachment.type === 'artifact' ? 'agent' : 'user',
      createdByUserId: userId,
      tags: ['attachment', attachment.type],
      metadata: {
        attachmentSource: attachment.source,
        url: attachment.url,
        ...attachment.metadata,
      },
    });
    items.push(item);
  }

  return items;
}
