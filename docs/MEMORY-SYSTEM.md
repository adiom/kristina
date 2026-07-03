# Memory System — cf-kristina

## Overview

The memory system provides persistent storage with vector search capabilities using pgvector. It uses a **four-namespace design** to isolate agent knowledge, user knowledge, space knowledge, and service knowledge.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                       Memory Store                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
│  │   Own    │  │   User   │  │   Space  │  │ Service  │    │
│  │(userId=  │  │(userId=  │  │(spaceId= │  │(service= │    │
│  │  NULL)   │  │  <id>)   │  │  <id>)   │  │  <id>)   │    │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘    │
│       │             │             │             │           │
│       └─────────────┼─────────────┼─────────────┘           │
│                     │             │                         │
│              ┌──────▼──────┐      │                         │
│              │ Vector Search│     │                         │
│              │  (pgvector)  │     │                         │
│              └─────────────┘     │                         │
│                                  │                         │
│              ┌───────────────────▼──────────┐              │
│              │     Secret Scanning Layer     │              │
│              └──────────────────────────────┘              │
└─────────────────────────────────────────────────────────────┘
```

## Four-Namespace Design

### Own Memory (`userId = NULL`)
Stores the agent's own knowledge:
- **Insights** extracted from reflection
- **Patterns** recognized in conversations
- **Knowledge** learned from interactions
- **Decisions** made and their reasoning
- **Reflections** from self-reflection cycles

### User Memory (`userId = <id>`)
Stores knowledge about specific people:
- **Preferences** — what they like/dislike
- **Topics** — what they discuss
- **Style** — how they communicate
- **History** — past interactions

### Space Memory (`spaceId = <id>`)
Stores knowledge scoped to a conversation space (sfera, chat, simulation):
- Space-specific context and patterns
- Cross-user knowledge within the space

### Service Memory (`service = <id>`)
Stores knowledge about a particular external service:
- Service-specific behavior patterns
- Integration-specific insights

## Memory Entry Structure

```typescript
interface StoreEntry {
  content: string;
  category: 'insight' | 'pattern' | 'knowledge' | 'decision' | 'reflection';
  importance: number; // 1-10
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
```

## Search Algorithm

### Vector Similarity
Uses pgvector cosine similarity:
```sql
1 - (embedding <=> query_embedding)
```

### Search Query
```typescript
async function searchMemory(query: string, options: SearchOptions) {
  const queryEmbedding = await generateEmbedding(query);
  const minSimilarity = options.minSimilarity || 0.7;
  const limit = options.limit || 5;

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
```

## Secret Scanning

Before storing any memory entry, the system scans for secrets using 8 regex patterns:
- API keys (`sk-*`, `key-*`, `token-*`)
- Passwords (`password=`, `pwd=`)
- Private keys (`BEGIN.*PRIVATE KEY`)
- Environment variables (`${...}`, `$ENV`)

If secrets are detected, the entry is rejected with an error.

## String-to-UUID Conversion

External services pass plain strings for `userId` and `spaceId`, but the database columns are typed as `uuid`. The system uses a deterministic UUIDv5 derivation (SHA-1 based) so the same input always maps to the same row:

```typescript
function stringToUuid(input: string): string {
  const hash = createHash('sha1')
    .update(NAMESPACE) // Fixed namespace UUID
    .update(input)
    .digest();
  // Set version (5) and variant (10xx) bits per RFC 4122
  // ... format as UUID string
}
```

## Embedding Generation

Uses local LM Studio endpoint with `text-embedding-nomic-embed-text-v1.5` (768-dim). Configurable via `EMBEDDING_MODEL` env variable.

```typescript
async function generateEmbedding(text: string): Promise<number[]> {
  const lmstudio = getLmStudio();
  const embeddingModel = lmstudio.embeddingModel(
    process.env.EMBEDDING_MODEL || 'text-embedding-nomic-embed-text-v1.5'
  );
  const { embedding } = await embed({ model: embeddingModel, value: text });
  return embedding;
}
```

## API Methods

Module-based functions (not class methods):

```typescript
// Write helpers
storeOwnMemory(entry: StoreEntry): Promise<void>
storeUserMemory(userId: string, entry: StoreEntry): Promise<void>
storeSpaceMemory(spaceId: string, entry: StoreEntry): Promise<void>
storeServiceMemory(serviceId: string, entry: StoreEntry): Promise<void>

// Read helpers
searchOwnMemory(query: string, options?: SearchOptions): Promise<MemoryResult[]>
searchUserMemory(userId: string, query: string, options?: SearchOptions): Promise<MemoryResult[]>
searchSpaceMemory(spaceId: string, query: string, options?: SearchOptions): Promise<MemoryResult[]>
searchServiceMemory(serviceId: string, query: string, options?: SearchOptions): Promise<MemoryResult[]>
```

## Database Schema

```sql
CREATE TABLE cf_kristina_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('insight', 'pattern', 'knowledge', 'decision', 'reflection')),
  importance INTEGER NOT NULL,
  tags TEXT[] DEFAULT '{}',
  user_id UUID,          -- NULL for agent's own memory
  space_id UUID,         -- Scoped to conversation space
  service TEXT,          -- Scoped to external service
  context JSONB,
  embedding VECTOR(768), -- pgvector 768-dim
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX memory_user_id_idx ON cf_kristina_memory(user_id);
CREATE INDEX memory_space_id_idx ON cf_kristina_memory(space_id);
CREATE INDEX memory_service_idx ON cf_kristina_memory(service);
CREATE INDEX memory_category_idx ON cf_kristina_memory(category);
CREATE INDEX memory_created_at_idx ON cf_kristina_memory(created_at);
```

## Performance Considerations

1. **Indexing**: Indexes on user_id, space_id, service, category, created_at
2. **Similarity threshold**: Minimum 0.7 cosine similarity by default
3. **Result limit**: Default 5 results per search
4. **Embedding dimension**: 768 (nomic-embed-text)

## Testing

- Unit tests for memory storage/retrieval
- Secret scanning tests (8 patterns)
- Vector search accuracy tests
- UUID deterministic conversion tests
