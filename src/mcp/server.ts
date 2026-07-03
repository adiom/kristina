import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createAgent } from '../agent/core';

export function createMcpServer(userId?: string) {
  const server = new McpServer({
    name: 'cf-kristina',
    version: '0.1.0',
  });

  server.registerTool('send_message', {
    title: 'Send Message',
    description: 'Отправить сообщение Кристине и получить ответ.',
    inputSchema: {
      message: z.string().describe('Сообщение для Кристины'),
      conversationId: z.string().optional().describe('ID разговора'),
    },
  }, async ({ message, conversationId }) => {
    const agent = createAgent(userId);
    const result = await agent.generate({ prompt: message });
    return {
      content: [{ type: 'text' as const, text: result.text }],
    };
  });

  server.registerTool('search_memory', {
    title: 'Search Memory',
    description: 'Поиск в памяти Кристины.',
    inputSchema: {
      query: z.string().describe('Поисковый запрос'),
    },
  }, async ({ query }) => {
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
  });

  return server;
}
