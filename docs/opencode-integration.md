# Adding Kristina to Your Service

Kristina is an external autonomous agent runtime. Your service remains a
thin adapter: authenticate the request, build `AgentContext`, call
Kristina, and render `AgentResult`.

## Transport and authentication

| Transport | Endpoint |
|---|---|
| HTTP agent | `POST /api/agent` |
| MCP Streamable HTTP | `POST /api/mcp` |
| Memory control | `POST /api/memory/search`, `/forget`, `/confirm`, `/status` |
| Standalone MCP | `src/mcp/server.ts` (local stdio) |

Web transports require HMAC service authentication once
`AGENT_SERVICE_CREDENTIALS` is configured. Every request must include:

```http
X-Agent-Service: news-site-xyz
X-Agent-Timestamp: 1783180800000
X-Agent-Signature: <hex-hmac>
```

The signature is:

```text
HMAC-SHA256(
  serviceSecret,
  timestamp + "\n" + serviceId + "\n" + SHA256(rawBody)
)
```

The timestamp is Unix milliseconds and is valid for five minutes. The
server compares signatures with `timingSafeEqual`.

Credentials are configured as JSON:

```json
{
  "news-site-xyz": {
    "secretBase64": "<base64-secret>",
    "scopes": ["agent:message", "memory:read", "memory:write"]
  }
}
```

Scopes:

- `agent:message` — call `/api/agent` or MCP `agent_message`.
- `memory:read` — search or inspect memory.
- `memory:write` — persist, confirm, or forget memory.
- `identity:link` — supply trusted `identityLinks`; this scope is only for
  operator/dashboard services.

Public requests cannot set `globalUserId`, `vaultId`, or trusted identity
data. The transports strip or ignore those fields and Kristina resolves the
vault from the authenticated `serviceId` plus `userId`.

## AgentContext

```ts
interface AgentContext {
  source: 'sfera' | 'http' | 'ws' | 'sim';
  serviceId: string;
  serviceName?: string;
  spaceId: string;
  spaceName?: string;
  userId?: string;
  userName?: string;
  /**
   * Completed service-side onboarding profile. Kristina writes it to the
   * resolved user vault before memory retrieval; unchanged profiles are not
   * rewritten.
   */
  userProfile?: {
    completed: true;
    name?: string;
    role?: string;
    interests?: string;
    goals?: string;
    context?: string;
    completedAt?: string;
  };
  attachments?: AgentAttachment[];
  conversationHistory?: ConversationMessage[];
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

`memoryAccess` is the namespace isolation contract. `userId` is local to
`serviceId`; identical IDs in different services do not represent the same
person unless an explicit identity link exists.

For a service with `identity:link`, `identityLinks` may contain explicit
cross-service links. Kristina never merges identities heuristically.

## Identity and memory behavior

1. Kristina resolves `(serviceId, userId)` through
   `cf_kristina_vault_identity_links`.
2. New identities receive `globalUserId = serviceId + ":" + userId`.
3. All user memory is keyed by the resolved `vaultId`.
4. A service may supply a completed `userProfile`; Kristina stores it as the
   vault profile before retrieval and skips the write when its hash is
   unchanged.
5. Retrieval reads the active vault profile, then durable facts/summaries,
   then episodes using semantic, full-text, importance, and recency signals.
6. Similar facts are deduplicated, confirmed, or superseded inside the same
   vault.
7. Deleted or superseded memories remain auditable but are excluded from
   retrieval.

Users can say:

- «что ты обо мне помнишь» — list active personal memories;
- «забудь, что…» — mark a matching memory deleted;
- «это уже не так» — mark a matching memory deleted/superseded.

## HTTP request

```http
POST /api/agent HTTP/1.1
Content-Type: application/json
X-Agent-Service: news-site-xyz
X-Agent-Timestamp: 1783180800000
X-Agent-Signature: <hex-hmac>
```

```json
{
  "prompt": "Собери новости по моим интересам",
  "context": {
    "source": "http",
    "serviceId": "news-site-xyz",
    "spaceId": "article-2026-09-14",
    "userId": "user-42",
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

Successful responses return `AgentResult`. Render `text` as untrusted text;
never inject it into raw HTML without sanitization.

## Memory control API

All memory endpoints use the same authenticated context body.

- `POST /api/memory/search` — `{ query, context }`
- `POST /api/memory/forget` — `{ query, exact?, context }`
- `POST /api/memory/confirm` — `{ memoryId?, query?, context }`
- `POST /api/memory/status` — `{ context }`

Writes require both `memoryAccess.write: true` and the `memory:write` scope.

## MCP tools

- `agent_message(prompt, context)`
- `agent_search(query, context)`
- `agent_memory_search(query, context)`
- `agent_memory_forget(query, exact?, context)`
- `agent_memory_confirm(memoryId?, query?, context)`
- `agent_memory_status(context)`
- `agent_info()`

The MCP SDK negotiates the MCP protocol version separately. The Kristina
agent contract version is currently **2.0.0** and is returned by `agent_info`
and the `X-Agent-Version` HTTP header.

## Failure modes

- `400` — invalid JSON, context, prompt, query, or target.
- `401` — missing, stale, or invalid service signature.
- `403` — missing scope, service mismatch, or forbidden memory write.
- `429` — rate limit exceeded for the service/user identity.
- `500` — internal error; details are logged but not exposed.
