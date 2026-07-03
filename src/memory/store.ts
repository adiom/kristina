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
  category?: string;
  minSimilarity?: number;
  limit?: number;
}

interface StoreEntry {
  content: string;
  category: 'insight' | 'pattern' | 'knowledge' | 'decision' | 'reflection';
  importance: number;
  tags?: string[];
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
    context: entry.context || {},
    embedding,
  });
}

export async function storeUserMemory(userId: string, entry: StoreEntry) {
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
    context: entry.context || {},
    embedding,
  });
}

export async function searchOwnMemory(
  query: string,
  options: SearchOptions = {}
) {
  return searchMemory(query, { ...options, userId: undefined });
}

export async function searchUserMemory(
  userId: string,
  query: string,
  options: SearchOptions = {}
) {
  return searchMemory(query, { ...options, userId });
}

async function searchMemory(query: string, options: SearchOptions) {
  const queryEmbedding = await generateEmbedding(query);
  const minSimilarity = options.minSimilarity || 0.7;
  const limit = options.limit || 5;

  let whereCondition;

  if (options.userId !== undefined) {
    whereCondition = and(
      eq(memory.userId, options.userId),
      options.category ? eq(memory.category, options.category as any) : undefined
    );
  } else {
    whereCondition = and(
      isNull(memory.userId),
      options.category ? eq(memory.category, options.category as any) : undefined
    );
  }

  const results = await db
    .select({
      id: memory.id,
      content: memory.content,
      category: memory.category,
      importance: memory.importance,
      tags: memory.tags,
      userId: memory.userId,
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
