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
│  └──────┬──────┘    └──────┬──────┘    └──────┬──────┘         │
│         │                  │                  │                 │
│         └──────────────────┼──────────────────┘                 │
│                            │                                    │
│                    ┌───────▼───────┐                            │
│                    │ Context Manager│                           │
│                    │ (Isolation)   │                            │
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

The runtime is transport‑agnostic – HTTP (`/api/agent`) and MCP
(`/api/mcp`) both delegate to it.  It:
* validates the request via the policy layer,
* retrieves memory from the allowed namespaces (`own`, `user`, `space`,
  `service`),
* builds a system prompt from the personality + event context,
* runs the LLM,
* logs the lifecycle in `activity_log`,
* persists any `memoryToStore` from the result (subject to
  `memoryAccess.write`),
* returns a structured `AgentResult`.

External services (Sfera, news sites, chat bots, simulations) only need
a tiny adapter that builds an `AgentContext` and renders the
`AgentResult`.  See `docs/opencode-integration.md` for the contract.

### 1. Context Manager
**Purpose**: Isolates conversations to prevent cross-user data leakage.

```typescript
interface IsolatedContext {
  id: string;
  type: 'chat' | 'economic_sim' | 'reflection';
  userId?: string;
  sferaId?: string;
  conversationHistory: Message[];
  memoryAccess: 'read_write' | 'read_only';
}
```

**Key Behavior**:
- Each dialogue gets its own context
- Memory is shared (read), but conversation history is isolated
- Economic simulations get read-only memory access to prevent contamination

The new `AgentContext` type (see `src/agent/types.ts`) supersedes the
legacy `IsolatedContext` and is what every transport uses.

### 2. Memory Store
**Purpose**: Persistent memory with vector search.

**Dual-Namespace Design**:
- `userId = NULL` — Agent's own knowledge (insights, patterns, market analysis)
- `userId = <id>` — Knowledge about specific people (preferences, topics, style)

**Memory Categories**:
- `insight` — Extracted from reflection
- `pattern` — Recognized behavioral patterns
- `knowledge` — Factual information
- `decision` — Decisions made and reasoning
- `reflection` — Reflection session outputs

**Search**: Vector similarity via pgvector (`1 - (embedding <=> query)`)

### 3. Reflection Cycle
**Purpose**: Self-improvement through scheduled introspection.

**Triggers**:
- `scheduled` — Every 30 minutes
- `interest_driven` — When interest grows above threshold
- `manual` — On-demand

**Cycle Steps**:
1. Select topic (from interests or manual)
2. Search memory for relevant context
3. LLM reasoning on the topic
4. Extract insights (importance 6-8)
5. Store insights in memory
6. Write to reflection diary
7. Update interest scores

### 4. Interest System
**Purpose**: Drives autonomous exploration.

**Interest Lifecycle**:
- **Generation**: Created from memory analysis
- **Growth**: +1.0 when explored (max 10)
- **Decay**: -0.1 per day (7-day half-life)
- **Cross-pollination**: Related interests grow when one is explored
- **Archive**: Below threshold 2 for 30 days → archived

**Interest Selection for Reflection**:
```
score = (priority * 3) + (recent_relevance * 2) + (growth_potential * 1.5)
```

### 5. Personality System
**Purpose**: Consistent, evolving character.

**Components**:
- **Core Prompt**: Fixed personality definition
- **Dynamic Traits**: Stored in DB with history
- **Emotional State**: Per-conversation emotional context

**Trait Evolution**:
- Adjusted based on conversation patterns
- History logged for audit
- Cross-pollination between related traits

### 6. Transparency Layer
**Purpose**: All agent actions visible to operators.

**Logged Events**:
- `message_received` — Incoming message
- `message_sent` — Agent response
- `memory_stored` — Memory entry saved
- `memory_searched` — Vector search executed
- `reflection_started/completed` — Reflection cycle
- `interest_generated/evolved` — Interest changes
- `decision_made` — Action decisions with reasoning

**Dashboard UI**:
- Memory browser (search, filter, inspect)
- Reflection timeline
- Interest graph (evolution over time)
- Activity feed (real-time)
- Reasoning viewer (CoT inspection)

## Data Flow

### Chat Message (Sfera via MCP)
```
1. MCP Server receives message
2. Context Manager creates IsolatedContext
3. Memory Store searches for relevant memories
4. Personality Core builds system prompt
5. LLM generates response
6. Memory Store saves conversation
7. Transparency Logger logs event
8. Response sent back via MCP
```

### Economic Simulation (ATMv0)
```
1. ATM Client receives tick perception
2. Context Manager creates simulation context
3. Memory Store searches for market patterns
4. LLM analyzes perception + memories
5. Decision generated (buy/sell/hold)
6. Intent sent via ATMv0 protocol
7. Memory Store logs decision
8. Transparency Logger records event
```

### Reflection Cycle
```
1. Trigger fires (scheduled or interest-driven)
2. Interest System selects topic
3. Context Manager creates reflection context
4. Memory Store searches for topic-related memories
5. LLM explores topic in depth
6. Insights extracted (importance 6-8)
7. Insights stored in memory
8. Diary updated
9. Interest scores adjusted
10. Transparency Logger records cycle
```

## Database Schema (Key Tables)

```sql
-- Memory entries
CREATE TABLE cf_kristina_memory (
  id UUID PRIMARY KEY,
  content TEXT NOT NULL,
  category TEXT NOT NULL,
  importance INTEGER NOT NULL,
  tags TEXT[],
  user_id UUID,          -- NULL for agent's own memory
  context JSONB,
  embedding VECTOR(1536),
  created_at TIMESTAMPTZ
);

-- Interests
CREATE TABLE cf_kristina_interests (
  id UUID PRIMARY KEY,
  topic TEXT NOT NULL,
  score DECIMAL NOT NULL,
  priority INTEGER NOT NULL,
  source TEXT NOT NULL,
  last_explored TIMESTAMPTZ,
  created_at TIMESTAMPTZ
);

-- Personality traits
CREATE TABLE cf_kristina_traits (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  value DECIMAL NOT NULL,
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

1. **Context Isolation**: No cross-user data leakage
2. **Secret Scanning**: Memory entries scanned before storage
3. **Rate Limiting**: Public endpoints protected
4. **No Secrets in Code**: `.env.local` only
5. **Audit Trail**: All actions logged for transparency

## Deployment

- **Platform**: Vercel (MVP)
- **Database**: Supabase or Neon (PostgreSQL + pgvector)
- **Local Dev**: localhost:3000
- **WebSocket**: For real-time dashboard updates
