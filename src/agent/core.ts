import { ToolLoopAgent, tool } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { z } from 'zod';
import { CORE_PERSONALITY } from './personality';
import {
  searchOwnMemory,
  searchUserMemory,
  storeOwnMemory,
} from '../memory/store';

const lmstudio = createOpenAICompatible({
  name: 'lmstudio',
  baseURL: process.env.LM_STUDIO_URL || 'http://localhost:1234/v1',
});

const model = lmstudio('qwen/qwen3-1.7b');

const tools = {
  searchOwnMemory: tool({
    description:
      'Search your own memory for insights, patterns, knowledge, and past decisions.',
    inputSchema: z.object({
      query: z.string().describe('The search query'),
      category: z
        .enum(['insight', 'pattern', 'knowledge', 'decision', 'reflection'])
        .optional()
        .describe('Filter by memory category'),
    }),
    execute: async ({ query, category }) => {
      const results = await searchOwnMemory(query, { category });
      return results.map((r) => ({
        content: r.content,
        category: r.category,
        importance: r.importance,
        similarity: r.similarity,
      }));
    },
  }),

  searchUserMemory: tool({
    description:
      'Search what you know about a specific user (preferences, topics, style, history).',
    inputSchema: z.object({
      userId: z.string().describe('The user ID to search memory for'),
      query: z.string().describe('The search query'),
    }),
    execute: async ({ userId, query }) => {
      const results = await searchUserMemory(userId, query);
      return results.map((r) => ({
        content: r.content,
        category: r.category,
        importance: r.importance,
        similarity: r.similarity,
      }));
    },
  }),

  storeMemory: tool({
    description:
      'Save new information to your memory for future reference. Use this to remember important insights, patterns, or knowledge.',
    inputSchema: z.object({
      content: z.string().describe('The content to remember'),
      category: z.enum([
        'insight',
        'pattern',
        'knowledge',
        'decision',
        'reflection',
      ]),
      importance: z.number().min(1).max(10).describe('Importance score 1-10'),
      tags: z.array(z.string()).optional().describe('Tags for categorization'),
    }),
    execute: async ({ content, category, importance, tags }) => {
      await storeOwnMemory({ content, category, importance, tags });
      return { stored: true };
    },
  }),
};

export function createAgent(userId?: string) {
  const instructions = userId
    ? `${CORE_PERSONALITY}\n\n## Current Context\nYou are speaking with user: ${userId}`
    : CORE_PERSONALITY;

  return new ToolLoopAgent({
    model,
    instructions,
    tools,
  });
}
