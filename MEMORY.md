# MEMORY.md — cf-kristina

## Agent Identity
- **Name**: cf-kristina
- **Purpose**: Autonomous AI agent with persistent memory, self-reflection, and personality
- **Creator**: adiom (Canfly)
- **Project**: AI-economic research (Autonomous AI Agents in Economic Environments)

## Project Context

### What is cf-kristina?
An autonomous AI agent that:
1. Remembers everything (persistent memory with vector search)
2. Reflects on its experiences (self-reflection cycle)
3. Has interests that evolve over time (interest system)
4. Maintains a consistent personality (dynamic traits)
5. Operates transparently (all actions logged)

### Why separate from Avrora Area?
- **Clean separation**: Independent deployment and development
- **Focus**: Economic simulation research requires specialized agent
- **Flexibility**: Can evolve independently without affecting main platform
- **MVP approach**: Start simple, add complexity as needed

### Key Design Decisions
1. **Four-namespace memory**: own, user, space, service
2. **Context isolation**: memoryAccess flags prevent cross-user/space/service leakage
3. **Interest-driven exploration**: Agent explores topics autonomously
4. **Transparency first**: All reasoning visible to operators

## Technical Context

### Stack
- **Next.js 16** (App Router)
- **PostgreSQL + pgvector** (768-dim embeddings)
- **Drizzle ORM**
- **LM Studio** (local OpenAI-compatible endpoint)
- **Vercel AI SDK** (`ai` + `@ai-sdk/openai-compatible`)
- **MCP SDK** (`@modelcontextprotocol/sdk`)
- **Jest + ts-jest** (testing)
- **ATMv0** (WebSocket) [planned]

### Database Tables
- `cf_kristina_memory` — Memory entries with 768-dim vector embeddings
- `cf_kristina_interests` — Interest scores and metadata
- `cf_kristina_traits` — Personality traits with history (last 50)
- `cf_kristina_activity_log` — Transparency logging (buffered writes)
- `cf_kristina_diary` — Reflection diary entries

### API Routes
- `/api/agent` — HTTP POST (main transport)
- `/api/mcp` — MCP JSON-RPC POST
- `/api/dashboard` — Dashboard data GET
- `/dashboard` — Dashboard UI
- `/chat` — Test chat UI

## Implemented Features

### Core Agent
- `processAgent()` — Single entry point for all transports
- Policy layer (validation, rate limiting, memory access control)
- LLM via LM Studio (qwen/qwen3-1.7b)

### Memory System
- 4-namespace memory store (own/user/space/service)
- pgvector 768-dim embeddings
- Secret scanning (8 regex patterns)
- String-to-UUID deterministic conversion (UUIDv5)
- Vector similarity search (min 0.7 cosine similarity)

### Reflection System
- Topic selection (weighted random from top 5 interests)
- Insight extraction via regex (`ИНСАЙТ:`)
- Reflection diary storage
- Interest growth after reflection (+0.5)

### Interest System
- Add/grow/decay/cross-pollinate/archive lifecycle
- Linear decay (0.1 * floor(days/7))
- PostgreSQL similarity() for related interests

### Personality System
- 8 default traits (Russian names)
- DB-backed with history (last 50 entries)
- Trait trend analysis (growing/declining/stable)

### Transparency System
- Buffered writes (max 50 events, 5s flush)
- Activity log with 9 event types
- Stats aggregation by type and channel
- Dashboard with memories, interests, traits, reflections, activity

### Transports
- HTTP POST `/api/agent`
- MCP JSON-RPC POST `/api/mcp` (tools: agent_message, agent_search, agent_info)

## Planned Features
- ATMv0 Client for economic simulations
- WebSocket real-time dashboard updates
- Sfera MCP integration
- Scheduled reflection triggers
- Interest auto-generation from memory analysis

## Memory of Previous Sessions

### Session 1: Architecture Planning (2026-07-03)
- Explored existing Avrora memory/reflection system
- Designed cf-kristina architecture
- Created project structure and documentation
- Key learnings:
  - Avrora uses `stepCountIs(8)` for tool-calling steps
  - Reflection uses `openai-gpt-5` model
  - Interest evolution has decay (7d) and growth (3d) cycles
  - Memory search uses cosine similarity with pgvector

## Active Interests (for reflection)
- `memory_systems` — Persistent memory architectures
- `agent_reflection` — Self-reflection mechanisms
- `economic_simulation` — Agent-based economic modeling
- `personality_engine` — Dynamic personality systems
- `transparency_ai` — Explainable AI systems

---

*This file is updated at the end of each session to maintain context across sessions.*
