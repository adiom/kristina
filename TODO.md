# TODO.md — cf-kristina

## Priority: High

### Project Setup
- [ ] Initialize Next.js project with TypeScript
- [ ] Configure Tailwind CSS
- [ ] Set up Drizzle ORM
- [ ] Create `.env.local` with required variables
- [ ] Set up PostgreSQL connection (Supabase/Neon)

### Database
- [ ] Create database schema (Drizzle)
- [ ] Generate migrations
- [ ] Apply migrations
- [ ] Create seed data for testing

### Memory System
- [ ] Implement `MemoryStore` class
- [ ] Add dual-namespace support (userId=null vs userId=<id>)
- [ ] Implement vector search with pgvector
- [ ] Create memory tools for AI
- [ ] Add secret scanning before storage

### Agent Core
- [ ] Implement `ContextManager` class
- [ ] Create `IsolatedContext` system
- [ ] Build LLM integration (Claude API)
- [ ] Add conversation history management
- [ ] Implement basic chat endpoint

## Priority: Medium

### Reflection System
- [ ] Implement `ReflectionCycle` class
- [ ] Create reflection triggers (scheduled, interest-driven)
- [ ] Build insight extraction logic
- [ ] Add reflection diary
- [ ] Implement interest update after reflection

### Interest System
- [ ] Implement `InterestSystem` class
- [ ] Add interest generation from memory
- [ ] Implement decay algorithm (7-day half-life)
- [ ] Implement growth algorithm (3-day window)
- [ ] Add cross-pollination between interests
- [ ] Implement archival (below threshold 2 for 30d)

### Personality System
- [ ] Create core personality prompt
- [ ] Implement dynamic traits (DB-backed)
- [ ] Add emotional state tracking
- [ ] Build trait evolution logic
- [ ] Add personality history logging

### Transparency
- [ ] Implement activity logging
- [ ] Create WebSocket for real-time updates (or SSE)
- [ ] Build dashboard UI components
- [ ] Add memory browser
- [ ] Add reflection timeline
- [ ] Add interest graph
- [ ] Add reasoning viewer

## Priority: Low

### Channels
- [ ] Implement MCP Server for Sfera integration
- [ ] Create ATMv0 Client for economic simulations
- [ ] Add webhook support for external integrations

### Testing
- [ ] Unit tests for memory system
- [ ] Integration tests for reflection cycle
- [ ] E2E tests for chat flow
- [ ] Load testing for vector search

### Documentation
- [ ] API documentation
- [ ] Deployment guide
- [ ] User guide for dashboard

---

## Completed

### 2026-07-03
- [x] Architecture design documented
- [x] Project structure defined
- [x] Tech stack selected
- [x] Database schema designed
- [x] CLAUDE.md created
- [x] ARCHITECTURE.md created
- [x] PROGRESS.md created
- [x] MEMORY.md created

---

## Notes

### Vercel Deployment Considerations
- No persistent WebSocket — use SSE or polling
- Serverless functions have cold start
- Database connection pooling important
- Edge runtime for some routes

### Testing Strategy
- Unit tests: Vitest
- Integration tests: Vitest + test database
- E2E tests: Playwright
- Load testing: k6 or artillery

### Monitoring
- Vercel Analytics for performance
- Sentry for error tracking
- Custom dashboard for agent activity
