/**
 * Persistent memory store for the cf-kristina agent.
 *
 * The store is organised into four logical namespaces:
 *
 *   • `own`     – the agent's own knowledge (userId = NULL)
 *   • `user`    – knowledge about a specific user (userId = <id>)
 *   • `space`   – knowledge scoped to a conversation space (spaceId = <id>)
 *   • `service` – knowledge about a particular external service (service = <id>)
 *
 * Read/write operations accept a `spaceId` and/or `service` filter so the
 * policy layer can enforce isolation.  The agent itself decides which
 * namespace a piece of knowledge belongs to; the store only persists it.
 */

import { db } from '../db';
import { memory } from '../db/schema';
import { eq, and, desc, sql, isNull, isNotNull } from 'drizzle-orm';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { embed } from 'ai';

// Embeddings run locally via Ollama (nomic-embed-text, 768-dim).
// LM Studio endpoint is reserved for chat completions if/when we go
// back to a local LLM.
function getEmbeddingsProvider() {
  return createOpenAICompatible({
    name: 'ollama',
    baseURL: process.env.OLLAMA_URL || 'http://localhost:11434/v1',
  });
}

const EMBEDDING_MODEL =
  process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text:latest';
const EMBEDDING_DIM = 768;

interface SearchOptions {
  userId?: string | null;
  vaultId?: string | null;
  spaceId?: string | null;
  service?: string | null;
  category?: string;
  minSimilarity?: number;
  limit?: number;
}

interface StoreEntry {
  content: string;
  category: 'insight' | 'pattern' | 'knowledge' | 'decision' | 'reflection';
  importance: number;
  tags?: string[];
  vaultId?: string | null;
  userId?: string | null;
  spaceId?: string | null;
  service?: string | null;
  context?: {
    channel?: string;
    emotionalTone?: string;
    situation?: string;
  };
}

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

function containsSecret(text: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(text));
}

/* ------------------------------------------------------------------ */
/* String → UUID conversion                                           */
/*                                                                     */
/* The `userId` and `spaceId` columns are typed as `uuid` in Postgres, */
/* but external services (Sfera, news sites, etc.) pass plain strings. */
/* We derive a deterministic UUIDv5 from each string so the same input */
/* always maps to the same row.  No external crypto dependency – just  */
/* a tiny SHA‑1 based implementation.                                  */
/* ------------------------------------------------------------------ */

import { createHash } from 'crypto';

// Fixed namespace UUID (arbitrary but stable) for our agent.
const NAMESPACE = '6f1c7aed-30d2-4f5b-9f88-3a5b9d2e4a11';

function stringToUuid(input: string): string {
  const hash = createHash('sha1')
    .update(NAMESPACE)
    .update(input)
    .digest();
  // Set version (5) and variant (10xx) bits per RFC 4122.
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return (
    hex.slice(0, 8) + '-' +
    hex.slice(8, 12) + '-' +
    hex.slice(12, 16) + '-' +
    hex.slice(16, 20) + '-' +
    hex.slice(20, 32)
  );
}

async function generateEmbedding(text: string): Promise<number[]> {
  try {
    const provider = getEmbeddingsProvider();
    const embeddingModel = provider.embeddingModel(EMBEDDING_MODEL);

    // 5-second timeout: ollama is local and fast, but we still don't
    // want to block a chat turn forever.
    const embeddingPromise = embed({ model: embeddingModel, value: text });
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Embedding timeout')), 5000),
    );

    const { embedding } = await Promise.race([
      embeddingPromise,
      timeoutPromise,
    ]);
    const vec = embedding as number[];
    if (vec.length !== EMBEDDING_DIM) {
      console.warn(
        `[memory] embedding dim mismatch: got ${vec.length}, expected ${EMBEDDING_DIM}`,
      );
    }
    return vec;
  } catch (err) {
    console.warn(
      '[generateEmbedding] Failed, using deterministic fallback:',
      (err as Error).message,
    );
    // Deterministic 768-dim fallback so the store still works while
    // ollama is warming up / offline.  Quality is poor (not semantic),
    // but writes never crash.
    const fallback: number[] = new Array(EMBEDDING_DIM);
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
    }
    for (let i = 0; i < EMBEDDING_DIM; i++) {
      hash = ((hash << 5) - hash + i) | 0;
      fallback[i] = Math.sin(hash) * 10000 % 1;
    }
    return fallback;
  }
}

/* ------------------------------------------------------------------ */
/* Write helpers                                                       */
/* ------------------------------------------------------------------ */

export async function storeOwnMemory(entry: StoreEntry) {
  if (containsSecret(entry.content)) {
    throw new Error('Memory entry rejected: contains potential secret');
  }

  const embedding = await generateEmbedding(entry.content);

  await db.insert(memory).values({
    content: entry.content,
    category: entry.category,
    importance: entry.importance,
    tags: entry.tags || [],
    vaultId: entry.vaultId ?? null,
    userId: null,
    spaceId: entry.spaceId ? stringToUuid(entry.spaceId) : null,
    service: entry.service ?? null,
    context: entry.context || {},
    embedding,
  });
}

export async function storeUserMemory(
  userId: string,
  entry: StoreEntry,
) {
  if (containsSecret(entry.content)) {
    throw new Error('Memory entry rejected: contains potential secret');
  }

  const embedding = await generateEmbedding(entry.content);

  await db.insert(memory).values({
    content: entry.content,
    category: entry.category,
    importance: entry.importance,
    tags: entry.tags || [],
    vaultId: entry.vaultId ?? null,
    userId: stringToUuid(userId),
    spaceId: entry.spaceId ? stringToUuid(entry.spaceId) : null,
    service: entry.service ?? null,
    context: entry.context || {},
    embedding,
  });
}

export async function storeSpaceMemory(
  spaceId: string,
  entry: StoreEntry,
) {
  if (containsSecret(entry.content)) {
    throw new Error('Memory entry rejected: contains potential secret');
  }

  const embedding = await generateEmbedding(entry.content);

  await db.insert(memory).values({
    content: entry.content,
    category: entry.category,
    importance: entry.importance,
    tags: entry.tags || [],
    vaultId: entry.vaultId ?? null,
    userId: entry.userId ? stringToUuid(entry.userId) : null,
    spaceId: stringToUuid(spaceId),
    service: entry.service ?? null,
    context: entry.context || {},
    embedding,
  });
}

export async function storeServiceMemory(
  serviceId: string,
  entry: StoreEntry,
) {
  if (containsSecret(entry.content)) {
    throw new Error('Memory entry rejected: contains potential secret');
  }

  const embedding = await generateEmbedding(entry.content);

  await db.insert(memory).values({
    content: entry.content,
    category: entry.category,
    importance: entry.importance,
    tags: entry.tags || [],
    vaultId: entry.vaultId ?? null,
    userId: entry.userId ? stringToUuid(entry.userId) : null,
    spaceId: entry.spaceId ? stringToUuid(entry.spaceId) : null,
    service: serviceId,
    context: entry.context || {},
    embedding,
  });
}

/* ------------------------------------------------------------------ */
/* Read helpers                                                        */
/* ------------------------------------------------------------------ */

export async function searchOwnMemory(
  query: string,
  options: SearchOptions = {},
) {
  return searchMemory(query, {
    ...options,
    userId: null,
  });
}

export async function searchUserMemory(
  userId: string,
  query: string,
  options: SearchOptions = {},
) {
  return searchMemory(query, {
    ...options,
    userId,
  });
}

export async function searchSpaceMemory(
  spaceId: string,
  query: string,
  options: SearchOptions = {},
) {
  return searchMemory(query, {
    ...options,
    spaceId,
  });
}

export async function searchServiceMemory(
  serviceId: string,
  query: string,
  options: SearchOptions = {},
) {
  return searchMemory(query, {
    ...options,
    service: serviceId,
  });
}

async function searchMemory(query: string, options: SearchOptions) {
  const queryEmbedding = await generateEmbedding(query);
  const minSimilarity = options.minSimilarity || 0.7;
  const limit = options.limit || 5;

  const conditions = [];

  if (options.userId !== undefined) {
    if (options.userId === null) {
      conditions.push(isNull(memory.userId));
    } else {
      // `userId` from external services is an arbitrary string (e.g.
      // "test-user-1").  The column is `uuid`, so we hash the string
      // into a deterministic UUIDv5 for the lookup only.
      const uuid = stringToUuid(options.userId);
      conditions.push(eq(memory.userId, uuid));
    }
  } else {
    // If no userId specified, exclude user‑scoped rows so the agent
    // never accidentally sees another user's private memories.
    conditions.push(isNull(memory.userId));
  }

  if (options.vaultId) {
    conditions.push(eq(memory.vaultId, options.vaultId));
  }

  if (options.spaceId) {
    conditions.push(eq(memory.spaceId, stringToUuid(options.spaceId)));
  }

  if (options.service) {
    // `service` is a plain text column – no conversion needed.
    conditions.push(eq(memory.service, options.service));
  }

  if (options.category) {
    conditions.push(eq(memory.category, options.category as any));
  }

  const whereCondition =
    conditions.length === 1 ? conditions[0] : and(...conditions);

  const results = await db
    .select({
      id: memory.id,
      content: memory.content,
      category: memory.category,
      importance: memory.importance,
      tags: memory.tags,
      userId: memory.userId,
      spaceId: memory.spaceId,
      service: memory.service,
      context: memory.context,
      createdAt: memory.createdAt,
      similarity: sql<number>`1 - (${memory.embedding} <=> ${sql.raw(`'[${queryEmbedding.join(',')}]'::vector`)})`,
    })
    .from(memory)
    .where(whereCondition)
    .orderBy(sql`${memory.embedding} <=> ${sql.raw(`'[${queryEmbedding.join(',')}]'::vector`)}`)
    .limit(limit);

  return results.filter((r) => r.similarity >= minSimilarity);
}
