import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createAgent } from '../agent/core';

function createMcpServer(userId?: string) {
  const server = new McpServer({
    name: 'kristina',
    version: '0.1.0',
  });

  server.tool(
    'send_message',
    'Отправить сообщение Кристине и получить ответ.',
    {
      message: z.string().describe('Сообщение для Кристины'),
      conversationId: z.string().optional().describe('ID разговора'),
    },
    async ({ message }) => {
      const agent = createAgent(userId);
      const result = await agent.generate({ prompt: message });
      return {
        content: [{ type: 'text' as const, text: result.text }],
      };
    },
  );

  server.tool(
    'search_memory',
    'Поиск в памяти Кристины.',
    {
      query: z.string().describe('Поисковый запрос'),
    },
    async ({ query }) => {
      const { searchOwnMemory } = await import('../memory/store');
      const results = await searchOwnMemory(query);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(results.map(r => ({
            content: r.content,
            category: r.category,
            similarity: r.similarity,
          })), null, 2),
        }],
      };
    },
  );

  return server;
}

const server = createMcpServer();
const transport = new StdioServerTransport();
server.connect(transport);
