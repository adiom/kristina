/**
 * Stateless MCP Streamable HTTP transport for Vercel/Next.js.
 *
 * The MCP SDK owns JSON-RPC parsing, protocol negotiation, tool discovery,
 * and transport errors. This route only creates a server for the request and
 * delegates the Web Standard Request to the official transport.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { processAgent } from '@/agent/core';
import { getAgentInfo, PROTOCOL_VERSION } from '@/agent/version';
import {
  searchOwnMemory,
  searchUserMemory,
  searchSpaceMemory,
  searchServiceMemory,
} from '@/memory/store';
import { canAccessMemory, PolicyError, validateContext } from '@/policy';
import type { AgentContext } from '@/agent/types';

export const runtime = 'nodejs';

const memoryAccessSchema = z.object({
  own: z.boolean(),
  user: z.boolean(),
  space: z.boolean(),
  service: z.boolean(),
  write: z.boolean(),
});

const contextSchema = z
  .object({
    source: z.enum(['sfera', 'http', 'ws', 'sim']),
    serviceId: z.string().min(1),
    serviceName: z.string().optional(),
    spaceId: z.string().min(1),
    spaceName: z.string().optional(),
    userId: z.string().optional(),
    userName: z.string().optional(),
    globalUserId: z.string().optional(),
    vaultId: z.string().optional(),
    trigger: z.enum(['mention', 'command', 'event', 'system']),
    responseMode: z.enum(['public', 'private', 'analysis', 'action', 'draft']),
    memoryAccess: memoryAccessSchema,
    conversationHistory: z
      .array(
        z.object({
          role: z.enum(['user', 'assistant', 'system']),
          author: z.string().optional(),
          content: z.string(),
        }),
      )
      .optional(),
  })
  .passthrough();

const agentContextSchema = contextSchema.transform(
  (context) => context as AgentContext,
);

function textResult(value: unknown, isError = false) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
}

function toolError(error: unknown) {
  if (error instanceof PolicyError) {
    return textResult({ code: error.code, message: error.message }, true);
  }

  console.error('[mcp] unexpected tool error', error);
  return textResult(
    { code: 'internal_error', message: 'Unexpected server error' },
    true,
  );
}

async function runSearch(query: string, context: AgentContext) {
  validateContext(context);

  const out: unknown[] = [];
  if (canAccessMemory(context, 'own')) {
    const own = await searchOwnMemory(query, { limit: 5 });
    own.forEach((memory) => out.push({ ...memory, scope: 'own' }));
  }
  if (canAccessMemory(context, 'user') && context.userId) {
    const user = await searchUserMemory(context.userId, query, { limit: 5 });
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

function createMcpServer() {
  const server = new McpServer({
    name: 'kristina',
    version: PROTOCOL_VERSION,
  });

  server.registerTool(
    'agent_info',
    {
      description: 'Return Kristina agent version and capabilities.',
      inputSchema: z.object({}),
    },
    async () => textResult(getAgentInfo()),
  );

  server.registerTool(
    'agent_message',
    {
      description:
        'Send a message to Kristina. Returns a structured answer with sources.',
      inputSchema: z.object({
        prompt: z.string().min(1),
        context: agentContextSchema,
      }),
    },
    async ({ prompt, context }) => {
      try {
        return textResult(await processAgent(prompt, context));
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
        return textResult(await runSearch(query, context));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  return server;
}

async function handle(request: Request) {
  const server = createMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    // Vercel functions are stateless; do not advertise an in-memory session.
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  try {
    await server.connect(transport);
    const response = await transport.handleRequest(request);
    const headers = new Headers(response.headers);
    headers.set('access-control-allow-origin', '*');
    headers.set(
      'access-control-allow-headers',
      'content-type, accept, mcp-session-id, last-event-id',
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
      {
        status: 500,
        headers: { 'content-type': 'application/json' },
      },
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
        'content-type, accept, mcp-session-id, last-event-id',
      'access-control-allow-methods': 'DELETE, GET, OPTIONS, POST',
      'access-control-allow-origin': '*',
    },
  });
}
