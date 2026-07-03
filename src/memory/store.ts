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

function getLmStudio() {
  return createOpenAICompatible({
    name: 'lmstudio',
    baseURL: process.env.LM_STUDIO_URL || 'http://localhost:1234/v1',
  });
}

interface SearchOptions {
  userId?: string;
  spaceId?: string;
  service?: string;
  category?: string;
  minSimilarity?: number;
  limit?: number;
}

interface StoreEntry {
  content: string;
  category: 'insight' | 'pattern' | 'knowledge' | 'decision' | 'reflection';
  importance: number;
  tags?: string[];
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

async function generateEmbedding(text: string): Promise<number[]> {
  const lmstudio = getLmStudio();
  const embeddingModel = lmstudio.embeddingModel(
    process.env.EMBEDDING_MODEL || 'text-embedding-nomic-embed-text-v1.5'
  );

  const { embedding } = await embed({
    model: embeddingModel,
    value: text,
  });

  return embedding;
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
    userId: null,
    spaceId: entry.spaceId ?? null,
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
    userId,
    spaceId: entry.spaceId ?? null,
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
    userId: entry.userId ?? null,
    spaceId,
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
    userId: entry.userId ?? null,
    spaceId: entry.spaceId ?? null,
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
      conditions.push(eq(memory.userId, options.userId));
    }
  } else {
    // If no userId specified, exclude user‑scoped rows so the agent
    // never accidentally sees another user's private memories.
    conditions.push(isNull(memory.userId));
  }

  if (options.spaceId) {
    conditions.push(eq(memory.spaceId, options.spaceId));
  }

  if (options.service) {
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
