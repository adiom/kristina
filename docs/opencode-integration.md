# Adding Kristina to Your Service

cf‑kristina is an **external autonomous agent runtime** that you can attach
to any service – a chat, a dashboard, a news site, a simulation, etc.
All of Kristina's intelligence (personality, memory, reflection, interests,
logging, policy) lives in **cf‑kristina**. Your service only needs a tiny
*adapter* that detects mentions, builds an event context, and renders the
result.

```
┌──────────────────┐   HTTP / MCP / WS   ┌────────────────────┐
│   Your service   │ ───────────────────▶│    cf‑kristina     │
│   (Sfera, news   │ ◀───────────────────│  (agent runtime)   │
│   site, bot)     │   AgentResult JSON  └────────────────────┘
└──────────────────┘
```

This document describes the two integration paths (HTTP and MCP), the
exact request/response shapes, and a step‑by‑step guide for adding
Kristina to a new service.

## 1. Integration paths

| Transport | Endpoint | Best for |
|-----------|----------|----------|
| HTTP | `POST /api/agent` | Simple backends, dashboards, mobile apps |
| MCP (JSON‑RPC 2.0) | `POST /api/mcp` | AI‑host environments, Claude / OpenCode style clients |
| WebSocket | (planned) | Long‑running simulations |

Both paths take the same `AgentContext` and return the same `AgentResult`
– switch transports without changing your adapter logic.

## 2. The AgentContext

Every call to Kristina must include a structured context describing the
event.  The minimum required fields are `source`, `serviceId`, `spaceId`,
`trigger`, `responseMode`, and `memoryAccess`.

```ts
interface AgentContext {
  source: 'sfera' | 'http' | 'ws' | 'sim';
  serviceId: string;          // identifier of your service, e.g. "news-site-xyz"
  serviceName?: string;
  spaceId: string;            // conversation / space / simulation ID
  spaceName?: string;
  userId?: string;
  userName?: string;
  conversationHistory?: Array<{ role: 'user'|'assistant'|'system'; author?: string; content: string }>;
  trigger: 'mention' | 'command' | 'event' | 'system';
  responseMode: 'public' | 'private' | 'analysis' | 'action' | 'draft';
  memoryAccess: {
    own: boolean;
    user: boolean;
    space: boolean;
    service: boolean;
    write: boolean;
  };
}
```

* **`memoryAccess`** is the isolation contract – toggle flags to tell
  Kristina which namespaces she may read and whether she may persist new
  knowledge.
* **`trigger`** helps Kristina interpret why she's being called.
* **`responseMode`** controls the tone (public reply, internal analysis,
  a draft you intend to edit, etc.).

## 3. The AgentResult

Kristina returns a structured result.  Render `text` to the user; use
`sources` for transparency, and `actions` to perform follow‑up tool
calls on your side.

```ts
interface AgentResult {
  text: string;                                      // main answer
  type: 'message' | 'analysis' | 'question' | 'warning' | 'action' | 'observation';
  confidence?: number;                               // 0..1
  memoryToStore?: Array<{ content: string; category: string; importance: number; tags: string[] }>;
  sources?: Array<{ id: string; snippet: string; similarity: number }>;
  actions?: Array<{ tool: string; args: any }>;
  metadata?: Record<string, unknown>;
}
```

## 4. HTTP example

```http
POST /api/agent HTTP/1.1
Content-Type: application/json
X-Agent-Version: 1.0.0

{
  "prompt": "@kristina собери новости опираясь на свои интересы",
  "context": {
    "source": "http",
    "serviceId": "news-site-xyz",
    "serviceName": "DailyNews",
    "spaceId": "article-2025-07-03",
    "spaceName": "Обзор рынков",
    "userId": "user-42",
    "userName": "Иван",
    "conversationHistory": [
      { "role": "user", "author": "Иван", "content": "Какие новости важны?" }
    ],
    "trigger": "mention",
    "responseMode": "public",
    "memoryAccess": {
      "own": true,
      "user": true,
      "space": true,
      "service": true,
      "write": true
    }
  }
}
```

Successful response:

```json
{
  "text": "На основании ваших интересов, ...",
  "type": "message",
  "confidence": 0.87,
  "sources": [
    { "id": "...", "snippet": "...", "similarity": 0.81 }
  ],
  "metadata": { "model": "qwen/qwen3-1.7b", "serviceId": "news-site-xyz" }
}
```

Errors are returned as `{ "error": { "code": "...", "message": "..." } }`
with appropriate HTTP status codes (`400`, `403`, `429`, `500`).

## 5. MCP example

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "agent_message",
    "arguments": {
      "prompt": "@kristina собери новости",
      "context": { "...": "..." }
    }
  }
}
```

Available tools:

* **`agent_message(prompt, context)`** – run the agent.
* **`agent_search(query, context)`** – read‑only memory search.
* **`agent_info()`** – version + capabilities.

The MCP `initialize` response includes `protocolVersion: "1.0.0"` and
`serverInfo.version: "1.0.0"`.

## 6. Step‑by‑step: adding Kristina to a new service

1. **Register the service** – pick a stable `serviceId` (e.g. `news-site-xyz`).
   This ID appears in logs and dashboards; it cannot be changed later.
2. **Detect the trigger** – in your UI / backend, watch for the mention
   (`@kristina`, `@kristina`, slash command, etc.) or a programmatic
   event.
3. **Create a placeholder** – show "Kristina is typing…" in the UI while
   the request is in flight.
4. **Build the context** – fill in `AgentContext`:
   * `source` (e.g. `http`)
   * `serviceId`, `spaceId`, `userId`, `userName`
   * `conversationHistory` (last 3‑5 messages)
   * `trigger` (`mention`, `command`, …)
   * `responseMode` (`public` for visible replies, `analysis` for
     internal notes, `draft` for human‑edited answers)
   * `memoryAccess` (start with all `true`; flip off if you want a
     read‑only interaction or to forbid persistence).
5. **Call the endpoint** – `POST /api/agent` or MCP `agent_message`.
6. **Render the answer** – replace the placeholder with `result.text`.
   Optionally show `result.sources` as "References".
7. **Handle failures**:
   * `429 rate_limited` – back off and retry after a few seconds.
   * `400 write_forbidden` – you asked for `write: true` but the context
     forbids writes; the agent will still answer, it just will not store
     new memory.
   * `500 internal_error` – show a friendly fallback message.
8. **Log & observe** – the activity log already records every call; the
   dashboard (`/dashboard?extended=1`) shows per‑service usage and
   recent answers.

## 7. Versioning

* Current protocol version: **1.0.0** (see `src/agent/version.ts`).
* The version is returned by `agent_info` (MCP) and the HTTP header
  `X-Agent-Version`.
* Bumping the version is a breaking change – adapters must check the
  version and fall back gracefully on older servers.

## 8. Security checklist

* Never call Kristina with `memoryAccess.write = true` for an untrusted
  service.  Start with `write: false` and opt‑in once the integration is
  reviewed.
* Validate the `serviceId` you send – it appears in logs and dashboards.
* Treat `result.text` as untrusted user‑renderable text; sanitise it
  before injecting raw HTML.
* Respect `429 rate_limited` – the runtime protects itself with a token
  bucket per service.
