# TODO.md — cf-kristina

## Priority: High

### Completed ✅
- [x] Initialize Next.js project with TypeScript
- [x] Configure Tailwind CSS v4
- [x] Set up Drizzle ORM
- [x] Create `.env.local` with required variables
- [x] Set up PostgreSQL connection
- [x] Create database schema (Drizzle)
- [x] Generate migrations
- [x] Apply migrations
- [x] Implement memory store (4-namespace)
- [x] Add vector search with pgvector (768-dim)
- [x] Create memory tools for AI
- [x] Add secret scanning before storage
- [x] Implement processAgent core
- [x] Create AgentContext system
- [x] Build LLM integration (LM Studio)
- [x] Add conversation history management
- [x] Implement HTTP endpoint (POST /api/agent)
- [x] Implement MCP endpoint (POST /api/mcp)
- [x] Implement reflection cycle
- [x] Create reflection triggers (manual)
- [x] Build insight extraction logic (ИНСАЙТ: regex)
- [x] Add reflection diary
- [x] Implement interest update after reflection
- [x] Implement interest system
- [x] Add interest lifecycle (add/grow/decay/cross-pollinate/archive)
- [x] Implement decay algorithm (linear)
- [x] Implement growth algorithm (+0.5)
- [x] Add cross-pollination between interests (+0.2)
- [x] Implement archival (below threshold 2 for 30d)
- [x] Create core personality prompt
- [x] Implement dynamic traits (DB-backed, 8 defaults)
- [x] Build trait evolution logic
- [x] Add personality history logging
- [x] Implement activity logging
- [x] Build dashboard UI components
- [x] Add memory browser
- [x] Add reflection timeline
- [x] Add interest graph
- [x] Implement policy layer (validation, rate limiting)
- [x] Write processAgent tests
- [x] Write policy tests

## Priority: Medium

### Vault — user storage 🚀
- [ ] Define `vault` model separately from semantic memory
- [ ] Introduce canonical `globalUserId` across all client apps
- [ ] Enforce server-side `userId` trust (no raw client userId)
- [ ] Create `cf_kristina_vaults` table
- [ ] Create `cf_kristina_vault_items` table for files/artifacts/memory refs
- [ ] Create `cf_kristina_vault_events` for audit
- [ ] Add vault creation on first `globalUserId`
- [ ] Add first-contact onboarding flow for new vault owners
- [ ] Store user media in object storage, not Postgres blobs
- [ ] Store vault metadata in DB only
- [ ] Connect vault to existing user-memory namespace
- [ ] Map `context.userId -> vaultId` in processAgent
- [ ] Add vault-aware memory extraction for first user answers
- [ ] Add vault-aware prompts for onboarding question
- [ ] Add tests for vault creation + onboarding flow

### In Progress 🔄
- [ ] Scheduled reflection triggers (cron/scheduler)
- [ ] Interest auto-generation from memory analysis

### Planned 📋
- [ ] Add emotional state tracking (valence/arousal/dominance)
- [ ] Add reasoning viewer (CoT inspection)
- [ ] Optimize performance
- [ ] Add error handling
- [ ] Deploy to Vercel
- [ ] API documentation
- [ ] Deployment guide
- [ ] User guide for dashboard

## Priority: Low

### Planned 📋
- [ ] Implement MCP Server for Sfera integration
- [ ] Create ATMv0 Client for economic simulations
- [ ] Add webhook support for external integrations
- [ ] Add WebSocket for real-time dashboard updates
- [ ] Integration tests for reflection cycle
- [ ] E2E tests for chat flow
- [ ] Load testing for vector search

---

## Vault & User Identity

- [ ] Pick stable global user ID source from auth system
- [ ] Ensure one `globalUserId` maps to one vault
- [ ] Use vault as container for:
  - memory about user
  - user-uploaded media/files
  - agent-created artifacts
- [ ] Do NOT store media blobs in main DB
- [ ] Keep DB as metadata layer only
- [ ] Add vault metadata fields:
  - `createdAt`
  - `onboardingStatus`
  - `lastSeenAt`
  - `status`
- [ ] Add vault items lifecycle: created, uploaded, referenced, archived
- [ ] Add onboarding state machine:
  1. no vault
  2. create vault
  3. ask first question
  4. save first profile data
  5. mark onboarding completed

---

## Notes

### Vercel Deployment Considerations
- No persistent WebSocket — use SSE or polling
- Serverless functions have cold start
- Database connection pooling important
- Edge runtime for some routes

### Testing Strategy
- Unit tests: Jest + ts-jest
- Integration tests: Jest + test database
- E2E tests: Playwright [planned]
- Load testing: k6 or artillery [planned]

### Monitoring
- Vercel Analytics for performance
- Sentry for error tracking [planned]
- Custom dashboard for agent activity
