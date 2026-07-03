# Memory System — cf-kristina

## Overview

The memory system provides persistent storage with vector search capabilities. It uses a dual-namespace design to separate agent's own knowledge from knowledge about specific users.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Memory Store                          │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─────────────────┐    ┌─────────────────┐             │
│  │  Agent Memory   │    │  User Memory    │             │
│  │  (userId=NULL)  │    │  (userId=<id>)  │             │
│  │                 │    │                 │             │
│  │ • insights      │    │ • preferences   │             │
│  │ • patterns      │    │ • topics        │             │
│  │ • knowledge     │    │ • style         │             │
│  │ • decisions     │    │ • history       │             │
│  └────────┬────────┘    └────────┬────────┘             │
│           │                      │                      │
│           └──────────────────────┘                      │
│                          │                              │
│                 ┌────────▼────────┐                      │
│                 │  Vector Search  │                      │
│                 │   (pgvector)    │                      │
│                 └─────────────────┘                      │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## Dual-Namespace Design

### Agent Memory (`userId = NULL`)
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

## Memory Entry Structure

```typescript
interface MemoryEntry {
  id: string;
  content: string;
  category: 'insight' | 'pattern' | 'knowledge' | 'decision' | 'reflection';
  importance: number; // 1-10
  tags: string[];
  context: {
    channel: 'chat' | 'economic_sim' | 'reflection';
    userId?: string;
    emotionalTone?: string;
    situation?: string;
  };
  embedding: number[];
  createdAt: Date;
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
async search(query: string, options: SearchOptions) {
  const queryEmbedding = await this.embedding.generate(query);
  
  return this.db.execute(sql`
    SELECT *, 
      1 - (embedding <=> ${queryEmbedding}::vector) as similarity
    FROM cf_kristina_memory
    WHERE 
      -- Namespace filtering
      (${options.userId}::uuid IS NULL AND userId IS NULL)
      OR (${options.userId}::uuid IS NOT NULL AND userId = ${options.userId}::uuid)
      -- Category filtering
      ${options.category ? sql`AND category = ${options.category}` : sql``}
      -- Similarity threshold
      AND 1 - (embedding <=> ${queryEmbedding}::vector) >= ${options.minSimilarity || 0.7}
    ORDER BY embedding <=> ${queryEmbedding}::vector
    LIMIT ${options.limit || 5}
  `);
}
```

## Secret Scanning

Before storing any memory entry, the system scans for:
- API keys (patterns: `sk-*`, `key-*`, `token-*`)
- Passwords (patterns: `password=`, `pwd=`)
- Private keys (patterns: `BEGIN.*PRIVATE KEY`)
- Environment variables (patterns: `${...}`, `$ENV`)

If secrets are detected, the entry is rejected and logged.

## Importance Scoring

Memory entries are scored 1-10 based on:
- **Relevance**: How relevant to current context
- **Uniqueness**: How unique/novel the information
- **Recency**: How recent the information
- **Impact**: Potential impact on future interactions

## Embedding Generation

Supports multiple providers:
- **nomic-embed-text** (local, free, good quality)
- **OpenAI text-embedding-3-small** (paid, better quality)
- **Voyage AI** (paid, best quality)

Default: nomic-embed-text for local development, OpenAI for production.

## API Methods

```typescript
class MemoryStore {
  // Store agent's own memory
  async storeOwnMemory(entry: Omit<MemoryEntry, 'context'>): Promise<void>;
  
  // Store memory about a user
  async storeUserMemory(userId: string, entry: Omit<MemoryEntry, 'context'>): Promise<void>;
  
  // Search agent's own memory
  async searchOwnMemory(query: string, options?: SearchOptions): Promise<MemoryEntry[]>;
  
  // Search memory about a specific user
  async searchUserMemory(userId: string, query: string, options?: SearchOptions): Promise<MemoryEntry[]>;
  
  // Generic search with namespace filtering
  async search(query: string, options: SearchOptions): Promise<MemoryEntry[]>;
  
  // Delete memory entry
  async delete(id: string): Promise<void>;
  
  // Update memory entry
  async update(id: string, updates: Partial<MemoryEntry>): Promise<void>;
}
```

## Performance Considerations

1. **Indexing**: Create HNSW index on embedding column
2. **Batch operations**: Use transactions for bulk inserts
3. **Connection pooling**: Use PgBouncer or Supabase pooler
4. **Caching**: Cache frequent searches (Redis or in-memory)

## Testing

- Unit tests for memory storage/retrieval
- Integration tests for vector search accuracy
- Load tests for search performance
- Edge tests for secret scanning
