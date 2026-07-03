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
1. **Dual-namespace memory**: Agent's own knowledge vs. knowledge about people
2. **Context isolation**: No cross-user data leakage
3. **Interest-driven exploration**: Agent自主地探索感兴趣的话题
4. **Transparency first**: All reasoning visible to operators

## Technical Context

### Stack
- **Next.js 14+** (App Router)
- **PostgreSQL + pgvector** (Supabase or Neon)
- **Drizzle ORM**
- **Claude API** (Anthropic)
- **Vercel AI SDK**
- **MCP SDK** (@modelcontextprotocol/sdk)
- **ATMv0** (WebSocket)

### Database Tables
- `cf_kristina_memory` — Memory entries with vector embeddings
- `cf_kristina_interests` — Interest scores and metadata
- `cf_kristina_traits` — Personality traits with history
- `cf_kristina_activity_log` — Transparency logging
- `cf_kristina_diary` — Reflection diary entries

### API Routes
- `/api/chat` — Handle chat messages
- `/api/memory` — CRUD for memories
- `/api/reflection` — Trigger reflection
- `/api/interests` — Manage interests
- `/api/dashboard` — Dashboard data
- `/api/mcp` — MCP server endpoint

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

## Open Questions
1. Which embedding model to use? (nomic-embed-text vs OpenAI)
2. How to handle WebSocket on Vercel? (SSE vs polling)
3. Multi-provider LLM or single provider?

## Next Actions
1. Initialize Next.js project
2. Set up database connection
3. Implement memory schema
4. Create basic API routes

---

*This file is updated at the end of each session to maintain context across sessions.*
