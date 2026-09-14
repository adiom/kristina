import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { processAgent } from '../agent/core';
import { PROTOCOL_VERSION } from '../agent/version';
import {
  confirmMemoryControl,
  forgetMemoryControl,
  memoryStatusControl,
  searchMemoryControl,
} from '../memory/control';
import { publicContextSchema } from '../transport/schemas';
import type { AgentContext } from '../agent/types';

const contextSchema = publicContextSchema.transform(
  (context) => context as AgentContext,
);

function textResult(value: unknown, isError = false) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
}

function createMcpServer() {
  const server = new McpServer({
    name: 'kristina',
    version: PROTOCOL_VERSION,
  });

  server.registerTool(
    'agent_message',
    {
      description: 'Send a message to Kristina through processAgent.',
      inputSchema: z.object({
        prompt: z.string().min(1),
        context: contextSchema,
      }),
    },
    async ({ prompt, context }) => textResult(await processAgent(prompt, context)),
  );

  server.registerTool(
    'agent_memory_search',
    {
      description: 'Search the supplied user’s personal vault memory.',
      inputSchema: z.object({
        query: z.string().min(1),
        context: contextSchema,
      }),
    },
    async ({ query, context }) =>
      textResult(await searchMemoryControl(query, context)),
  );

  server.registerTool(
    'agent_memory_forget',
    {
      description: 'Mark a personal memory as deleted.',
      inputSchema: z.object({
        query: z.string().min(1),
        exact: z.boolean().optional(),
        context: contextSchema,
      }),
    },
    async ({ query, exact, context }) =>
      textResult(await forgetMemoryControl(query, context, { exact: exact === true })),
  );

  server.registerTool(
    'agent_memory_confirm',
    {
      description: 'Confirm a personal memory.',
      inputSchema: z.object({
        memoryId: z.string().optional(),
        query: z.string().optional(),
        context: contextSchema,
      }),
    },
    async ({ memoryId, query, context }) =>
      textResult(await confirmMemoryControl({ memoryId, query }, context)),
  );

  server.registerTool(
    'agent_memory_status',
    {
      description: 'List active personal memories.',
      inputSchema: z.object({ context: contextSchema }),
    },
    async ({ context }) => textResult(await memoryStatusControl(context)),
  );

  return server;
}

const server = createMcpServer();
const transport = new StdioServerTransport();
await server.connect(transport);
