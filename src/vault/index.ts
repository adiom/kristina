import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { vaultEvents, vaultIdentityLinks, vaultItems, vaults } from '../db/schema';
import type { AgentAttachment, AgentIdentityLink } from '../agent/types';

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

/**
 * Resolve the global user identifier for a `(serviceId, userId)` pair.
 *
 * 1. If the caller already passed a `globalUserId`, trust it.
 * 2. Otherwise look up the identity link table.
 * 3. Otherwise fall back to `userId` so legacy single-service callers
 *    keep working.
 *
 * Returns `null` if there is no `userId` to resolve at all.
 */
export async function resolveGlobalUserId(
  serviceId: string | undefined,
  userId: string | undefined,
): Promise<string | null> {
  if (!userId) return null;
  if (!serviceId) return userId;

  const link = await db.query.vaultIdentityLinks.findFirst({
    where: and(
      eq(vaultIdentityLinks.serviceId, serviceId),
      eq(vaultIdentityLinks.externalUserId, userId),
    ),
  });
  if (link) return link.vaultId;
  return userId;
}

/**
 * Upsert identity links for a vault.  Used by both the runtime (when an
 * adapter sends `identityLinks` in the context) and by the dashboard
 * linking endpoint.
 */
export async function upsertIdentityLinks(
  vaultId: string,
  links: AgentIdentityLink[],
): Promise<void> {
  if (!links || links.length === 0) return;

  for (const link of links) {
    if (!link.serviceId || !link.userId) continue;
    await db
      .insert(vaultIdentityLinks)
      .values({
        vaultId,
        serviceId: link.serviceId,
        externalUserId: link.userId,
        displayName: link.userName ?? null,
        isPrimary: Boolean(link.primary),
        linkedAt: new Date(),
        lastSeenAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [vaultIdentityLinks.serviceId, vaultIdentityLinks.externalUserId],
        set: {
          vaultId,
          displayName: link.userName ?? sql`${vaultIdentityLinks.displayName}`,
          isPrimary: Boolean(link.primary),
          lastSeenAt: new Date(),
        },
      });

    await db.insert(vaultEvents).values({
      vaultId,
      type: link.primary ? 'identity_linked_primary' : 'identity_linked',
      actorType: 'system',
      details: {
        serviceId: link.serviceId,
        externalUserId: link.userId,
        displayName: link.userName,
      },
    });
  }
}

/**
 * Dashboard helper: list every identity link for a vault, ordered with
 * the primary first.
 */
export async function listIdentityLinks(vaultId: string) {
  return db
    .select()
    .from(vaultIdentityLinks)
    .where(eq(vaultIdentityLinks.vaultId, vaultId))
    .orderBy(desc(vaultIdentityLinks.isPrimary), desc(vaultIdentityLinks.linkedAt));
}

/**
 * Dashboard helper: link a new (serviceId, userId) pair to an existing
 * vault, optionally transferring the pair from another vault (which is
 * how the dashboard merges two accounts into one).
 */
export async function linkIdentityToVault(input: {
  vaultId: string;
  serviceId: string;
  externalUserId: string;
  displayName?: string;
  primary?: boolean;
}): Promise<void> {
  await upsertIdentityLinks(input.vaultId, [
    {
      serviceId: input.serviceId,
      userId: input.externalUserId,
      userName: input.displayName,
      primary: input.primary,
    },
  ]);

  if (input.displayName) {
    await db
      .update(vaults)
      .set({ displayName: input.displayName, updatedAt: new Date() })
      .where(eq(vaults.id, input.vaultId));
  }
}

export async function ensureUserVault(
  globalUserId: string,
  options: EnsureUserVaultOptions = {},
): Promise<UserVaultSession> {
  const existing = await db.query.vaults.findFirst({
    where: eq(vaults.globalUserId, globalUserId),
  });

  if (existing) {
    const nextDisplayName = options.displayName ?? existing.displayName;
    await db
      .update(vaults)
      .set({
        displayName: nextDisplayName,
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
  content?: string;
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

/**
 * Read or update the single `profile` vault item for a vault.  Kristina
 * stores a person's profile as one structured record so the dashboard
 * can render it and the LLM can read it back in one query instead of
 * scanning the whole `user` memory namespace.
 */
export async function getVaultProfile(vaultId: string) {
  return db.query.vaultItems.findFirst({
    where: and(eq(vaultItems.vaultId, vaultId), eq(vaultItems.kind, 'profile')),
  });
}

export async function upsertVaultProfile(input: {
  vaultId: string;
  title: string;
  content?: string;
  source: 'user' | 'agent' | 'system';
  createdByUserId?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}) {
  const existing = await getVaultProfile(input.vaultId);
  const tags = Array.from(new Set([...(existing?.tags ?? []), ...(input.tags ?? [])]));

  if (existing) {
    const [updated] = await db
      .update(vaultItems)
      .set({
        title: input.title,
        summary: input.content ?? existing.summary,
        tags: tags as any,
        metadata: { ...(existing.metadata ?? {}), ...(input.metadata ?? {}) },
        updatedAt: new Date(),
      })
      .where(eq(vaultItems.id, existing.id))
      .returning();
    await db.insert(vaultEvents).values({
      vaultId: input.vaultId,
      itemId: existing.id,
      type: 'profile_updated',
      actorType: input.source,
      actorId: input.createdByUserId,
      details: { title: input.title },
    });
    return updated;
  }

  const created = await createVaultItem({
    vaultId: input.vaultId,
    kind: 'profile',
    title: input.title,
    summary: input.content,
    source: input.source,
    createdByUserId: input.createdByUserId,
    tags: input.tags,
    metadata: input.metadata,
  });
  await db.insert(vaultEvents).values({
    vaultId: input.vaultId,
    itemId: created.id,
    type: 'profile_created',
    actorType: input.source,
    actorId: input.createdByUserId,
    details: { title: input.title },
  });
  return created;
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
