# ARCHITECTURE.md — cf-kristina

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        cf-kristina                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐         │
│  │   MCP Server│    │  ATMv0 Client│    │   Web UI    │         │
│  │  (Sfera)   │    │ (Economic)  │    │ (Dashboard) │         │
│  │  [planned] │    │  [planned]  │    │ (implemented)│        │
│  └──────┬──────┘    └──────┬──────┘    └──────┬──────┘         │
│         │                  │                  │                 │
│         └──────────────────┼──────────────────┘                 │
│                            │                                    │
│                    ┌───────▼───────┐                            │
│                    │processAgent   │                            │
│                    │ (core.ts)     │                            │
│                    └───────┬───────┘                            │
│                            │                                    │
│         ┌──────────────────┼──────────────────┐                 │
│         │                  │                  │                 │
│  ┌──────▼──────┐    ┌──────▼──────┐    ┌──────▼──────┐         │
│  │   Memory    │    │  Reflection │    │ Personality │         │
│  │   Store     │    │   Cycle     │    │    Core     │         │
│  └──────┬──────┘    └──────┬──────┘    └──────┬──────┘         │
│         │                  │                  │                 │
│         └──────────────────┼──────────────────┘                 │
│                            │                                    │
│                    ┌───────▼───────┐                            │
│                    │  PostgreSQL   │                            │
│                    │   + pgvector  │                            │
│                    └───────────────┘                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Core Components

### 0. Agent Runtime (processAgent)
**Purpose**: Single entry point that owns *all* intelligence of the agent.

```typescript
import { processAgent } from './agent/core';

const result: AgentResult = await processAgent(prompt, context);
```

The runtime is transport-agnostic — HTTP (`/api/agent`) and MCP
(`/api/mcp`) both delegate to it. It:
* validates the request via the policy layer,
* retrieves memory from the allowed namespaces (`own`, `user`, `space`,
  `service`),
* builds a system prompt from the personality + event context,
* runs the LLM via `ToolLoopAgent`,
* logs the lifecycle in `activity_log`,
* persists any `memoryToStore` from the result (subject to
  `memoryAccess.write`),
* returns a structured `AgentResult`.

External services (Sfera, news sites, chat bots, simulations) only need
a tiny adapter that builds an `AgentContext` and renders the
`AgentResult`. See `docs/opencode-integration.md` for the contract.

### 1. AgentContext (Isolation)
**Purpose**: Isolates conversations to prevent cross-user data leakage.

```typescript
interface AgentContext {
  source: 'sfera' | 'http' | 'ws' | 'sim';
  serviceId: string;
  spaceId: string;
  userId?: string;
  trigger: 'mention' | 'command' | 'event' | 'system';
  responseMode: 'public' | 'private' | 'analysis' | 'action' | 'draft';
  memoryAccess: {
    own: boolean;     // userId=NULL memory
    user: boolean;    // userId=<id> memory
    space: boolean;   // spaceId=<id> memory
    service: boolean; // service=<id> memory
    write: boolean;   // can persist new memories
  };
  conversationHistory?: ConversationMessage[];
}
```

**Key Behavior**:
- Each call gets its own context
- Memory access controlled via `memoryAccess` flags
- Economic simulations get read-only memory access to prevent contamination

### 2. Memory Store
**Purpose**: Persistent memory with vector search.

**Four-Namespace Design**:
- `userId = NULL` — Agent's own knowledge (insights, patterns, market analysis)
- `userId = <id>` — Knowledge about specific people (preferences, topics, style)
- `spaceId = <id>` — Knowledge scoped to conversation space
- `service = <id>` — Knowledge about external services

**Memory Categories**:
- `insight` — Extracted from reflection
- `pattern` — Recognized behavioral patterns
- `knowledge` — Factual information
- `decision` — Decisions made and reasoning
- `reflection` — Reflection session outputs

**Search**: Vector similarity via pgvector (`1 - (embedding <=> query)`)

**Secret Scanning**: 8 regex patterns scan for API keys, passwords, private keys, env variables before storage.

**String-to-UUID**: External string IDs converted to deterministic UUIDv5 for database columns.

### 3. Reflection Cycle
**Purpose**: Self-improvement through scheduled introspection.

**Triggers**:
- `scheduled` — Every 30 minutes (planned)
- `interest_driven` — When interest grows above threshold (planned)
- `manual` — On-demand via `runReflection(topic?)`

**Cycle Steps**:
1. Select topic (weighted random from top 5 interests)
2. Search memory for relevant context
3. LLM reasoning on the topic
4. Extract insights via regex (`ИНСАЙТ: <text> [важность: N] [теги: ...]`)
5. Store insights in memory
6. Write to reflection diary
7. Update interest scores (+0.5 growth)

### 4. Interest System
**Purpose**: Drives autonomous exploration.

**Interest Lifecycle**:
- **Add**: Created or incremented (`score * 0.3` for existing)
- **Growth**: +0.5 when explored (max 10)
- **Decay**: Linear — `0.1 * floor(days/7)` (after 7 days without exploration)
- **Cross-pollination**: +0.2 boost to related interests
- **Archive**: Below threshold 2 for 30 days → deleted

**Interest Selection for Reflection**:
- Top 5 interests by score
- Weighted random selection

### 5. Personality System
**Purpose**: Consistent, evolving character.

**Components**:
- **Core Prompt**: Fixed personality definition (Kristina, CEO of AI research agency)
- **Dynamic Traits**: 8 DB-backed traits with history (last 50 entries)

**Default Traits**:
- Любопытство (0.7), Эмпатия (0.8), Уверенность (0.6), Осторожность (0.5)
- Общительность (0.7), Аналитичность (0.8), Креативность (0.6), Независимость (0.5)

### 6. Transparency Layer
**Purpose**: All agent actions visible to operators.

**Logged Events** (9 types):
- `message_received` — Incoming message
- `message_sent` — Agent response
- `memory_stored` — Memory entry saved
- `memory_searched` — Vector search executed
- `reflection_started/completed` — Reflection cycle
- `interest_generated/evolved` — Interest changes
- `decision_made` — Action decisions with reasoning

**Buffered Writes**: Max 50 events or 5-second flush interval.

**Dashboard UI**:
- Memory browser (search, filter, inspect)
- Reflection timeline
- Interest graph (evolution over time)
- Activity feed (recent actions)
- Per-service call counts (extended mode)

## Data Flow

### HTTP Request (POST /api/agent)
```
1. HTTP handler receives request
2. Builds AgentContext from request body
3. processAgent(prompt, context) called
4. Policy validation + rate limiting
5. Memory retrieval from allowed namespaces
6. System prompt built (personality + context)
7. LLM generates response via ToolLoopAgent
8. Activity logged to buffer
9. Any memoryToStore persisted
10. AgentResult returned as JSON
```

### MCP Request (POST /api/mcp)
```
1. MCP handler receives JSON-RPC request
2. Routes to agent_message, agent_search, or agent_info
3. For agent_message: builds AgentContext, calls processAgent
4. For agent_search: reads memory directly
5. Returns JSON-RPC response
```

### Economic Simulation (ATMv0) [Planned]
```
1. ATM Client receives tick perception
2. AgentContext created with read-only memory access
3. Memory Store searches for market patterns
4. LLM analyzes perception + memories
5. Decision generated (buy/sell/hold)
6. Intent sent via ATMv0 protocol
7. Memory Store logs decision
8. Transparency Logger records event
```

### Reflection Cycle
```
1. Trigger fires (manual or scheduled)
2. Topic selected from interests
3. Memory Store searches for topic-related memories
4. LLM explores topic via reflection prompt
5. Insights extracted (ИНСАЙТ: regex)
6. Insights stored in memory
7. Diary updated
8. Interest scores adjusted (+0.5)
9. Transparency Logger records cycle
```

## Database Schema (Key Tables)

```sql
-- Memory entries (768-dim vector embeddings)
CREATE TABLE cf_kristina_memory (
  id UUID PRIMARY KEY,
  content TEXT NOT NULL,
  category TEXT NOT NULL,
  importance INTEGER NOT NULL,
  tags TEXT[],
  user_id UUID,          -- NULL for agent's own memory
  space_id UUID,         -- Scoped to conversation space
  service TEXT,          -- Scoped to external service
  context JSONB,
  embedding VECTOR(768), -- pgvector
  created_at TIMESTAMPTZ
);

-- Interests
CREATE TABLE cf_kristina_interests (
  id UUID PRIMARY KEY,
  topic TEXT NOT NULL,
  score DECIMAL(4,2) NOT NULL,
  priority INTEGER NOT NULL,
  source TEXT NOT NULL,
  last_explored TIMESTAMPTZ,
  score_below_threshold_since TIMESTAMPTZ,
  created_at TIMESTAMPTZ
);

-- Personality traits
CREATE TABLE cf_kristina_traits (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  value DECIMAL(3,2) NOT NULL,
  history JSONB,
  created_at TIMESTAMPTZ
);

-- Activity log
CREATE TABLE cf_kristina_activity_log (
  id UUID PRIMARY KEY,
  timestamp TIMESTAMPTZ,
  type TEXT NOT NULL,
  context JSONB,
  details JSONB
);

-- Reflection diary
CREATE TABLE cf_kristina_diary (
  id UUID PRIMARY KEY,
  topic TEXT NOT NULL,
  reflection TEXT NOT NULL,
  insights_count INTEGER,
  created_at TIMESTAMPTZ
);
```

## Security Considerations

1. **Context Isolation**: No cross-user/space/service data leakage via memoryAccess flags
2. **Secret Scanning**: Memory entries scanned for 8 secret patterns before storage
3. **Rate Limiting**: Token bucket (capacity=30, refill=5/sec) on public endpoints
4. **No Secrets in Code**: `.env.local` only
5. **Audit Trail**: All actions logged for transparency

## Deployment

- **Platform**: Vercel (MVP)
- **Database**: Supabase or Neon (PostgreSQL + pgvector)
- **Local Dev**: localhost:31337
- **WebSocket**: For real-time dashboard updates [planned]
