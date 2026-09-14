import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { processAgent } from '@/agent/core';
import { getAgentInfo, PROTOCOL_VERSION } from '@/agent/version';
import {
  confirmMemoryControl,
  forgetMemoryControl,
  memoryStatusControl,
  searchMemoryControl,
} from '@/memory/control';
import {
  searchOwnMemory,
  searchServiceMemory,
  searchSpaceMemory,
} from '@/memory/store';
import {
  assertScope,
  authenticateServiceRequest,
  hasScope,
  ServiceAuthError,
  type ServiceAuthResult,
} from '@/auth/service-auth';
import { canAccessMemory, PolicyError, validateContext } from '@/policy';
import { publicContextSchema } from '@/transport/schemas';
import type { AgentContext } from '@/agent/types';

export const runtime = 'nodejs';

const agentContextSchema = publicContextSchema.transform(
  (context) => context as AgentContext,
);

function textResult(value: unknown, isError = false) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
}

function toolError(error: unknown) {
  if (error instanceof PolicyError || error instanceof ServiceAuthError) {
    return textResult({ code: error.code, message: error.message }, true);
  }

  console.error('[mcp] unexpected tool error', error);
  return textResult(
    { code: 'internal_error', message: 'Unexpected server error' },
    true,
  );
}

function trustedContext(context: AgentContext, auth: ServiceAuthResult) {
  const allowIdentityLinks = hasScope(auth, 'identity:link');
  return {
    ...context,
    identityLinks: allowIdentityLinks ? context.identityLinks : undefined,
    runtimeTrust: { allowIdentityLinks },
  };
}

async function runSearch(query: string, context: AgentContext) {
  validateContext(context);
  const out: unknown[] = [];

  if (canAccessMemory(context, 'own')) {
    const own = await searchOwnMemory(query, { limit: 5 });
    own.forEach((memory) => out.push({ ...memory, scope: 'own' }));
  }
  if (canAccessMemory(context, 'user') && context.userId) {
    const user = await searchMemoryControl(query, context, 5);
    user.forEach((memory) => out.push({ ...memory, scope: 'user' }));
  }
  if (canAccessMemory(context, 'space')) {
    const space = await searchSpaceMemory(context.spaceId, query, { limit: 5 });
    space.forEach((memory) => out.push({ ...memory, scope: 'space' }));
  }
  if (canAccessMemory(context, 'service')) {
    const service = await searchServiceMemory(context.serviceId, query, {
      limit: 5,
    });
    service.forEach((memory) => out.push({ ...memory, scope: 'service' }));
  }
  return out;
}

function createMcpServer(auth: ServiceAuthResult) {
  const server = new McpServer({
    name: 'kristina',
    version: PROTOCOL_VERSION,
  });

  server.registerTool(
    'agent_info',
    { description: 'Return Kristina version and capabilities.', inputSchema: z.object({}) },
    async () => textResult(getAgentInfo()),
  );

  server.registerTool(
    'agent_message',
    {
      description: 'Send a message to Kristina.',
      inputSchema: z.object({
        prompt: z.string().min(1),
        context: agentContextSchema,
      }),
    },
    async ({ prompt, context }) => {
      try {
        assertScope(auth, 'agent:message');
        if (context.memoryAccess.write) assertScope(auth, 'memory:write');
        return textResult(await processAgent(prompt, trustedContext(context, auth)));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'agent_search',
    {
      description: 'Search Kristina memory within the supplied context.',
      inputSchema: z.object({
        query: z.string().min(1),
        context: agentContextSchema,
      }),
    },
    async ({ query, context }) => {
      try {
        assertScope(auth, 'memory:read');
        return textResult(await runSearch(query, context));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'agent_memory_search',
    {
      description: 'Search the authenticated user’s personal vault memory.',
      inputSchema: z.object({
        query: z.string().min(1),
        context: agentContextSchema,
      }),
    },
    async ({ query, context }) => {
      try {
        assertScope(auth, 'memory:read');
        return textResult(await searchMemoryControl(query, context));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'agent_memory_forget',
    {
      description: 'Mark a personal memory as deleted.',
      inputSchema: z.object({
        query: z.string().min(1),
        exact: z.boolean().optional(),
        context: agentContextSchema,
      }),
    },
    async ({ query, exact, context }) => {
      try {
        assertScope(auth, 'memory:write');
        return textResult(
          await forgetMemoryControl(query, context, { exact: exact === true }),
        );
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'agent_memory_confirm',
    {
      description: 'Confirm a personal memory and increase its confidence.',
      inputSchema: z.object({
        memoryId: z.string().optional(),
        query: z.string().optional(),
        context: agentContextSchema,
      }),
    },
    async ({ memoryId, query, context }) => {
      try {
        assertScope(auth, 'memory:write');
        return textResult(
          await confirmMemoryControl({ memoryId, query }, context),
        );
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'agent_memory_status',
    {
      description: 'List active personal memories for the authenticated user.',
      inputSchema: z.object({ context: agentContextSchema }),
    },
    async ({ context }) => {
      try {
        assertScope(auth, 'memory:read');
        return textResult(await memoryStatusControl(context));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  return server;
}

function authFailure(error: ServiceAuthError) {
  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32001, message: error.message, data: { code: error.code } },
      id: null,
    }),
    { status: 401, headers: { 'content-type': 'application/json' } },
  );
}

function expectedServiceFromRpc(rawBody: string): string | undefined {
  try {
    const body = JSON.parse(rawBody) as {
      params?: { arguments?: { context?: { serviceId?: unknown } } };
    };
    const serviceId = body.params?.arguments?.context?.serviceId;
    return typeof serviceId === 'string' ? serviceId : undefined;
  } catch {
    return undefined;
  }
}

async function handle(request: Request) {
  const rawBody = await request.clone().text();
  console.log('[mcp] request', {
    method: request.method,
    url: request.url,
    accept: request.headers.get('accept'),
    contentType: request.headers.get('content-type'),
    mcpSessionId: request.headers.get('mcp-session-id'),
    bodyLength: rawBody.length,
  });
  console.log('[mcp] body', rawBody);

  let auth: ServiceAuthResult;
  try {
    auth = await authenticateServiceRequest({
      headers: request.headers,
      rawBody,
      expectedServiceId: expectedServiceFromRpc(rawBody),
    });
  } catch (error) {
    if (error instanceof ServiceAuthError) {
      console.log('[mcp] auth failed', { code: error.code, message: error.message });
      return authFailure(error);
    }
    throw error;
  }
  console.log('[mcp] auth ok', { serviceId: auth.serviceId, scopes: auth.scopes });

  const server = createMcpServer(auth);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  try {
    await server.connect(transport);
    const response = await transport.handleRequest(request);
    console.log('[mcp] response', { status: response.status, statusText: response.statusText });
    const headers = new Headers(response.headers);
    headers.set('access-control-allow-origin', '*');
    headers.set(
      'access-control-allow-headers',
      'content-type, accept, mcp-session-id, last-event-id, x-agent-service, x-agent-timestamp, x-agent-signature',
    );
    headers.set('access-control-allow-methods', 'DELETE, GET, OPTIONS, POST');
    headers.set('access-control-expose-headers', 'mcp-session-id');
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch (error) {
    console.error('[mcp] transport error', error);
    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null,
      }),
      { status: 500, headers: { 'content-type': 'application/json' } },
    );
  }
}

export async function POST(request: Request) {
  return handle(request);
}

export async function GET(request: Request) {
  return handle(request);
}

export async function DELETE(request: Request) {
  return handle(request);
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-headers':
        'content-type, accept, mcp-session-id, last-event-id, x-agent-service, x-agent-timestamp, x-agent-signature',
      'access-control-allow-methods': 'DELETE, GET, OPTIONS, POST',
      'access-control-allow-origin': '*',
    },
  });
}
