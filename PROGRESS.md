# PROGRESS.md — cf-kristina

## Current Status: Planning Phase

### Completed
- [x] Architecture design documented
- [x] Core components defined
- [x] Database schema designed
- [x] Tech stack selected (Next.js + Vercel)

### In Progress
- [ ] Project initialization
- [ ] Database schema implementation
- [ ] Memory system core

### Next Steps

#### Phase 1: Foundation (Week 1)
1. Initialize Next.js project
2. Set up Drizzle + PostgreSQL connection
3. Implement database schema
4. Create basic API routes

#### Phase 2: Memory System (Week 2)
1. Implement Memory Store with dual-namespace
2. Add vector search via pgvector
3. Create memory tools for AI
4. Test memory search accuracy

#### Phase 3: Agent Core (Week 3)
1. Implement Context Manager
2. Create IsolatedContext system
3. Build LLM integration (Claude)
4. Test basic conversation flow

#### Phase 4: Reflection System (Week 4)
1. Implement Reflection Cycle
2. Create interest generation
3. Build interest evolution (decay/growth)
4. Test reflection triggers

#### Phase 5: Personality (Week 5)
1. Implement core personality prompt
2. Add dynamic traits system
3. Create emotional state tracking
4. Test personality consistency

#### Phase 6: Channels (Week 6)
1. Implement MCP Server for Sfera
2. Create ATMv0 Client
3. Test integration with Avrora
4. Test economic simulation connection

#### Phase 7: Transparency (Week 7)
1. Implement activity logging
2. Create dashboard UI
3. Add real-time WebSocket updates
4. Test transparency features

#### Phase 8: Polish & Deploy (Week 8)
1. Optimize performance
2. Add error handling
3. Deploy to Vercel
4. Documentation

---

## Decisions Log

### 2026-07-03: Initial Architecture
- **Decision**: Separate project from Avrora Area
- **Reason**: Clean separation of concerns, independent deployment
- **Impact**: New project structure, independent database

### 2026-07-03: Tech Stack
- **Decision**: Next.js + Vercel for MVP
- **Reason**: Fast deployment, good DX, serverless
- **Impact**: Need to handle WebSocket differently (Vercel doesn't support persistent WS)

### 2026-07-03: Dual-Namespace Memory
- **Decision**: userId=NULL for agent's own memory, userId=<id> for user-specific
- **Reason**: Clean separation, no cross-contamination
- **Impact**: Need careful query design, index optimization

---

## Open Questions

1. **WebSocket for real-time dashboard?** Vercel doesn't support persistent WS. Options:
   - Use Vercel KV (Redis) for pub/sub
   - Use Server-Sent Events (SSE)
   - Use polling for MVP

2. **Embedding model?** Options:
   - nomic-embed-text (local, free)
   - OpenAI text-embedding-3-small (paid, better quality)
   - Voyage AI (paid, best quality)

3. **LLM provider?** Options:
   - Claude (Anthropic) — best for reasoning
   - GPT-4o (OpenAI) — good for function calling
   - Multi-provider — more complex but flexible

---

## Milestones

| Milestone | Target Date | Status |
|-----------|-------------|--------|
| Project initialized | 2026-07-05 | Pending |
| Database schema live | 2026-07-07 | Pending |
| Memory search working | 2026-07-10 | Pending |
| Basic conversation flow | 2026-07-14 | Pending |
| Reflection cycle complete | 2026-07-21 | Pending |
| MCP integration | 2026-07-28 | Pending |
| Dashboard MVP | 2026-08-04 | Pending |
| Vercel deployment | 2026-08-11 | Pending |

---

## Notes

### Key Learnings from Avrora
- The existing Avrora system at `/Users/adiom/Canfly/2026/avrora` has full implementations of memory, reflection, and personality
- Key files to reference:
  - `lib/avrora/reflection-triggers.ts` — reflection trigger evaluation
  - `lib/avrora/interest-evolution.ts` — interest decay/growth logic
  - `lib/ai/embeddings.ts` — embedding generation service
  - `lib/ai/prompts/core.ts` — core personality prompt
  - `lib/ai/tools/avrora-memory.ts` — memory tools

### ATMv0 Protocol
- User's own protocol for agent↔environment communication
- Spec: `https://raw.githubusercontent.com/adiom/ATMv0/refs/heads/main/ATMv0.md`
- Key features: intent-based actions, tick-based simulation, JSONL messages

### MCP Protocol
- Model Context Protocol for external tool integration
- Used for connecting to Avrora Sfera
- Server listens on configurable port
