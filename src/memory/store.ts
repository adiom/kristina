import { createHash } from 'crypto';
import { and, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import { embed } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { db } from '../db';
import { memory } from '../db/schema';

export type MemoryType = 'fact' | 'episode' | 'summary';
export type MemoryStatus =
  | 'active'
  | 'superseded'
  | 'expired'
  | 'deleted'
  | 'legacy_local_only';
export type MemorySourceType =
  | 'explicit'
  | 'auto'
  | 'agent'
  | 'reflection'
  | 'onboarding';

const EMBEDDING_MODEL =
  process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text:latest';
const EMBEDDING_DIM = 768;
const UUID_NAMESPACE = '6f1c7aed-30d2-4f5b-9f88-3a5b9d2e4a11';

const SECRET_PATTERNS = [
  /sk-[a-zA-Z0-9]{20,}/,
  /key-[a-zA-Z0-9]{20,}/,
  /token-[a-zA-Z0-9]{20,}/,
  /password\s*[=:]\s*\S+/i,
  /pwd\s*[=:]\s*\S+/i,
  /BEGIN.*PRIVATE KEY/,
  /\$\{[^}]+\}/,
  /\$[A-Z_]+/,
];

export interface SearchOptions {
  userId?: string | null;
  vaultId?: string | null;
  spaceId?: string | null;
  service?: string | null;
  category?: string;
  memoryTypes?: MemoryType[];
  statuses?: MemoryStatus[];
  minSimilarity?: number;
  limit?: number;
}

export interface StoreEntry {
  content: string;
  category?: 'insight' | 'pattern' | 'knowledge' | 'decision' | 'reflection';
  importance?: number;
  tags?: string[];
  vaultId?: string | null;
  userId?: string | null;
  spaceId?: string | null;
  service?: string | null;
  memoryType?: MemoryType;
  confidence?: number;
  sourceType?: MemorySourceType;
  lastConfirmedAt?: Date;
  validUntil?: Date | null;
  context?: {
    channel?: string;
    emotionalTone?: string;
    situation?: string;
  };
}

export interface StoreResult {
  stored: boolean;
  confirmed?: boolean;
  superseded?: boolean;
  memoryId?: string;
  confidence?: number;
}

export interface MemorySearchResult {
  id: string;
  content: string;
  category: string;
  importance: number;
  tags: string[] | null;
  userId: string | null;
  vaultId: string | null;
  spaceId: string | null;
  service: string | null;
  memoryType: MemoryType;
  status: MemoryStatus;
  confidence: number;
  sourceType: MemorySourceType;
  lastConfirmedAt: Date | null;
  validUntil: Date | null;
  localUserId: string | null;
  context: Record<string, unknown> | null;
  createdAt: Date;
  similarity: number;
  textScore: number;
  rankScore: number;
}

function containsSecret(text: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(text));
}

function stringToUuid(input: string): string {
  const hash = createHash('sha1')
    .update(UUID_NAMESPACE)
    .update(input)
    .digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function contentHash(content: string): string {
  return createHash('sha256')
    .update(content.trim().toLowerCase(), 'utf8')
    .digest('hex');
}

function clampConfidence(confidence: number | undefined): number {
  return Math.max(0, Math.min(100, Math.round(confidence ?? 70)));
}

function getEmbeddingsProvider() {
  return createOpenAICompatible({
    name: 'ollama',
    baseURL: process.env.OLLAMA_URL || 'http://localhost:11434/v1',
  });
}

async function generateEmbedding(text: string): Promise<number[]> {
  try {
    const provider = getEmbeddingsProvider();
    const embeddingModel = provider.embeddingModel(EMBEDDING_MODEL);
    const embeddingPromise = embed({ model: embeddingModel, value: text });
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Embedding timeout')), 5000),
    );
    const { embedding } = await Promise.race([embeddingPromise, timeoutPromise]);
    const vector = embedding as number[];
    if (vector.length !== EMBEDDING_DIM) {
      console.warn(
        `[memory] embedding dim mismatch: got ${vector.length}, expected ${EMBEDDING_DIM}`,
      );
    }
    return vector;
  } catch (err) {
    console.warn(
      '[generateEmbedding] Failed, using deterministic fallback:',
      (err as Error).message,
    );
    const fallback = new Array<number>(EMBEDDING_DIM);
    let hash = 0;
    for (let index = 0; index < text.length; index += 1) {
      hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
    }
    for (let index = 0; index < EMBEDDING_DIM; index += 1) {
      hash = ((hash << 5) - hash + index) | 0;
      fallback[index] = ((hash >>> 8) % 1000) / 1000;
    }
    return fallback;
  }
}

function queryVector(embedding: number[]): string {
  if (
    embedding.length !== EMBEDDING_DIM ||
    embedding.some((value) => !Number.isFinite(value))
  ) {
    throw new Error('Invalid embedding vector');
  }
  return `'[${embedding.join(',')}]'::vector`;
}

async function insertMemory(entry: StoreEntry): Promise<string> {
  if (containsSecret(entry.content)) {
    throw new Error('Memory entry rejected: contains potential secret');
  }

  const embedding = await generateEmbedding(entry.content);
  const [created] = await db
    .insert(memory)
    .values({
      content: entry.content,
      category: entry.category ?? 'knowledge',
      importance: entry.importance ?? 5,
      tags: entry.tags ?? [],
      vaultId: entry.vaultId ?? null,
      userId: entry.userId ? stringToUuid(entry.userId) : null,
      spaceId: entry.spaceId ? stringToUuid(entry.spaceId) : null,
      service: entry.service ?? null,
      memoryType: entry.memoryType ?? 'episode',
      status: 'active',
      confidence: clampConfidence(entry.confidence),
      sourceType: entry.sourceType ?? 'auto',
      lastConfirmedAt: entry.lastConfirmedAt ?? new Date(),
      validUntil: entry.validUntil ?? null,
      contentHash: contentHash(entry.content),
      embeddingModel: EMBEDDING_MODEL,
      localUserId: entry.userId ?? null,
      context: entry.context || {},
      embedding,
    })
    .returning({ id: memory.id });

  if (!created) throw new Error('Failed to store memory');
  return created.id;
}

export async function storeOwnMemory(entry: StoreEntry) {
  await insertMemory({ ...entry, vaultId: null, userId: null });
}

export async function storeUserMemory(userId: string, entry: StoreEntry) {
  if (!entry.vaultId) {
    throw new Error('User memory requires vaultId');
  }
  await insertMemory({ ...entry, userId });
}

export async function storeVaultMemory(
  vaultId: string,
  entry: StoreEntry,
  localUserId?: string,
) {
  await insertMemory({
    ...entry,
    vaultId,
    userId: localUserId ?? entry.userId ?? null,
  });
}

export async function storeSpaceMemory(spaceId: string, entry: StoreEntry) {
  await insertMemory({ ...entry, spaceId });
}

export async function storeServiceMemory(serviceId: string, entry: StoreEntry) {
  await insertMemory({ ...entry, service: serviceId });
}

async function updateConfirmation(
  memoryId: string,
  confidence: number,
): Promise<number> {
  const nextConfidence = clampConfidence(confidence);
  await db
    .update(memory)
    .set({ confidence: nextConfidence, lastConfirmedAt: new Date() })
    .where(eq(memory.id, memoryId));
  return nextConfidence;
}

export async function upsertVaultMemory(
  vaultId: string,
  entry: StoreEntry,
  localUserId?: string,
): Promise<StoreResult> {
  if (containsSecret(entry.content)) {
    throw new Error('Memory entry rejected: contains potential secret');
  }

  const hash = contentHash(entry.content);
  const exact = await db
    .select({ id: memory.id, confidence: memory.confidence })
    .from(memory)
    .where(and(eq(memory.vaultId, vaultId), eq(memory.contentHash, hash)))
    .limit(1);

  if (exact[0]) {
    const confidence = await updateConfirmation(
      exact[0].id,
      Math.max(exact[0].confidence, entry.confidence ?? 70),
    );
    return { stored: false, confirmed: true, memoryId: exact[0].id, confidence };
  }

  const semantic = await searchVaultMemory(vaultId, entry.content, {
    minSimilarity: 0.82,
    limit: 1,
    statuses: ['active'],
  });
  const duplicate = semantic[0];
  const duplicateAction = resolveDuplicateAction(duplicate, entry.confidence ?? 70);

  if (duplicateAction === 'confirm' && duplicate) {
    const confidence = await updateConfirmation(
      duplicate.id,
      Math.max(duplicate.confidence, entry.confidence ?? 70),
    );
    return { stored: false, confirmed: true, memoryId: duplicate.id, confidence };
  }

  const memoryId = await insertMemory({
    ...entry,
    vaultId,
    userId: localUserId ?? entry.userId ?? null,
  });

  if (duplicateAction === 'supersede' && duplicate) {
    await db
      .update(memory)
      .set({ status: 'superseded', supersededBy: memoryId })
      .where(eq(memory.id, duplicate.id));
    return { stored: true, superseded: true, memoryId };
  }

  return { stored: true, memoryId };
}

export function resolveDuplicateAction(
  duplicate: { similarity: number; confidence: number } | undefined,
  nextConfidence: number,
): 'create' | 'confirm' | 'supersede' {
  if (!duplicate) return 'create';
  if (duplicate.similarity >= 0.95) return 'confirm';
  if (nextConfidence >= duplicate.confidence) return 'supersede';
  return 'create';
}

export async function searchOwnMemory(
  query: string,
  options: SearchOptions = {},
) {
  return searchMemory(query, { ...options, userId: null });
}

export async function searchUserMemory(
  userId: string,
  query: string,
  options: SearchOptions = {},
) {
  if (!options.vaultId) {
    throw new Error('User memory search requires vaultId');
  }
  return searchMemory(query, { ...options, userId, vaultId: options.vaultId });
}

export async function searchVaultMemory(
  vaultId: string,
  query: string,
  options: Omit<SearchOptions, 'vaultId' | 'userId'> = {},
) {
  return searchMemory(query, { ...options, vaultId });
}

export async function searchSpaceMemory(
  spaceId: string,
  query: string,
  options: SearchOptions = {},
) {
  return searchMemory(query, { ...options, spaceId });
}

export async function searchServiceMemory(
  serviceId: string,
  query: string,
  options: SearchOptions = {},
) {
  return searchMemory(query, { ...options, service: serviceId });
}

async function searchMemory(
  query: string,
  options: SearchOptions,
): Promise<MemorySearchResult[]> {
  const embedding = await generateEmbedding(query);
  const vector = sql.raw(queryVector(embedding));
  const minSimilarity = options.minSimilarity ?? 0.7;
  const limit = options.limit ?? 5;
  const statuses = options.statuses ?? ['active'];
  const conditions = [
    inArray(memory.status, statuses),
    or(isNull(memory.validUntil), gt(memory.validUntil, new Date())),
  ];

  if (options.userId !== undefined) {
    if (options.userId === null) {
      conditions.push(isNull(memory.userId));
    } else {
      conditions.push(eq(memory.userId, stringToUuid(options.userId)));
    }
  } else if (!options.vaultId) {
    conditions.push(isNull(memory.userId));
  }

  if (options.vaultId) conditions.push(eq(memory.vaultId, options.vaultId));
  if (options.spaceId) {
    conditions.push(eq(memory.spaceId, stringToUuid(options.spaceId)));
  }
  if (options.service) conditions.push(eq(memory.service, options.service));
  if (options.category) {
    conditions.push(eq(memory.category, options.category as never));
  }
  if (options.memoryTypes?.length) {
    conditions.push(inArray(memory.memoryType, options.memoryTypes));
  }

  const textScore = sql<number>`CASE WHEN to_tsvector('simple', ${memory.content}) @@ plainto_tsquery('simple', ${query}) THEN 1 ELSE 0 END`;
  const similarity = sql<number>`1 - (${memory.embedding} <=> ${vector})`;
  const rankScore = sql<number>`(${similarity} + (0.25 * ${textScore}) + (${memory.importance}::numeric / 100) + (1.0 / (1 + EXTRACT(EPOCH FROM (now() - ${memory.createdAt})) / 86400)))`;

  const rows = await db
    .select({
      id: memory.id,
      content: memory.content,
      category: memory.category,
      importance: memory.importance,
      tags: memory.tags,
      userId: memory.userId,
      vaultId: memory.vaultId,
      spaceId: memory.spaceId,
      service: memory.service,
      memoryType: memory.memoryType,
      status: memory.status,
      confidence: memory.confidence,
      sourceType: memory.sourceType,
      lastConfirmedAt: memory.lastConfirmedAt,
      validUntil: memory.validUntil,
      localUserId: memory.localUserId,
      context: memory.context,
      createdAt: memory.createdAt,
      similarity,
      textScore,
      rankScore,
    })
    .from(memory)
    .where(and(...conditions))
    .orderBy(sql`${rankScore} DESC`)
    .limit(limit);

  return rows
    .map((row) => ({
      ...row,
      similarity: Number(row.similarity),
      textScore: Number(row.textScore),
      rankScore: Number(row.rankScore),
    }))
    .filter((row) => row.similarity >= minSimilarity || row.textScore > 0);
}

export async function listVaultMemories(
  vaultId: string,
  options: { statuses?: MemoryStatus[]; limit?: number } = {},
) {
  return db
    .select()
    .from(memory)
    .where(
      and(
        eq(memory.vaultId, vaultId),
        inArray(memory.status, options.statuses ?? ['active']),
      ),
    )
    .orderBy(sql`${memory.createdAt} DESC`)
    .limit(options.limit ?? 100);
}

export async function confirmVaultMemory(
  vaultId: string,
  target: { memoryId?: string; query?: string },
) {
  let memoryId = target.memoryId;
  if (!memoryId && target.query) {
    const found = await searchVaultMemory(vaultId, target.query, {
      limit: 1,
      minSimilarity: 0.6,
    });
    memoryId = found[0]?.id;
  }
  if (!memoryId) return { confirmed: false };

  const existing = await db
    .select({ id: memory.id, confidence: memory.confidence })
    .from(memory)
    .where(and(eq(memory.id, memoryId), eq(memory.vaultId, vaultId)))
    .limit(1);
  if (!existing[0]) return { confirmed: false };

  await updateConfirmation(existing[0].id, existing[0].confidence + 10);
  return { confirmed: true, memoryId };
}

export async function forgetVaultMemory(
  vaultId: string,
  query: string,
  options: { exact?: boolean } = {},
) {
  if (options.exact) {
    const hash = contentHash(query);
    const updated = await db
      .update(memory)
      .set({ status: 'deleted' })
      .where(and(eq(memory.vaultId, vaultId), eq(memory.contentHash, hash)))
      .returning({ id: memory.id });
    return {
      forgotten: updated.length,
      memoryIds: updated.map((row) => row.id),
    };
  }

  const matches = await searchVaultMemory(vaultId, query, {
    limit: 1,
    minSimilarity: 0.65,
  });
  if (!matches[0]) return { forgotten: 0, memoryIds: [] };

  await db
    .update(memory)
    .set({ status: 'deleted' })
    .where(and(eq(memory.id, matches[0].id), eq(memory.vaultId, vaultId)));
  return { forgotten: 1, memoryIds: [matches[0].id] };
}
