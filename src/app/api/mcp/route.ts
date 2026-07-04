/**
 * MCP transport for the Kristina agent runtime.
 *
 * Exposes the agent over JSON‑RPC 2.0 (Model Context Protocol).  The
 * available tools are:
 *
 *   - agent_message(prompt, context) → run the agent and return text
 *   - agent_search(query, context)   → search memory (read‑only)
 *   - agent_info()                   → version + capabilities
 *
 * `processAgent` does all the real work – this file is just a thin
 * adapter that translates JSON‑RPC into the typed `AgentContext` and
 * `AgentResult` shapes defined in `src/agent/types.ts`.
 */

import { NextRequest, NextResponse } from 'next/server';
import { processAgent } from '@/agent/core';
import { getAgentInfo, PROTOCOL_VERSION } from '@/agent/version';
import {
  searchOwnMemory,
  searchUserMemory,
  searchSpaceMemory,
  searchServiceMemory,
} from '@/memory/store';
import { canAccessMemory, PolicyError } from '@/policy';
import type { AgentContext } from '@/agent/types';

export async function POST(request: NextRequest) {
  let raw = '';
  try {
    raw = await request.text();
    const body = JSON.parse(raw);
    const { method, params, id } = body;

    if (method === 'initialize') {
      return NextResponse.json({
        jsonrpc: '2.0',
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: {
            name: 'kristina',
            version: PROTOCOL_VERSION,
          },
        },
        id,
      });
    }

    if (method === 'notifications/initialized') {
      return NextResponse.json({ jsonrpc: '2.0', result: null, id });
    }

    if (method === 'tools/list') {
      return NextResponse.json({
        jsonrpc: '2.0',
        result: {
          tools: [
            {
              name: 'agent_message',
              description:
                'Send a message to Kristina. Returns a structured answer with sources.',
              inputSchema: {
                type: 'object',
                properties: {
                  prompt: { type: 'string' },
                  context: { type: 'object' },
                },
                required: ['prompt', 'context'],
              },
            },
            {
              name: 'agent_search',
              description:
                'Search Kristina memory (read‑only) within the given context.',
              inputSchema: {
                type: 'object',
                properties: {
                  query: { type: 'string' },
                  context: { type: 'object' },
                },
                required: ['query', 'context'],
              },
            },
            {
              name: 'agent_info',
              description: 'Return agent version and capabilities.',
              inputSchema: { type: 'object', properties: {} },
            },
          ],
        },
        id,
      });
    }

    if (method === 'tools/call') {
      const { name, arguments: args } = params || {};

      if (name === 'agent_info') {
        return NextResponse.json({
          jsonrpc: '2.0',
          result: {
            content: [
              { type: 'text', text: JSON.stringify(getAgentInfo(), null, 2) },
            ],
          },
          id,
        });
      }

      if (name === 'agent_message') {
        const { prompt, context } = args || {};
        try {
          const result = await processAgent(
            prompt,
            context as AgentContext,
          );
          return NextResponse.json({
            jsonrpc: '2.0',
            result: {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            },
            id,
          });
        } catch (err) {
          return mcpError(id, err);
        }
      }

      if (name === 'agent_search') {
        const { query, context } = args || {};
        if (!context) {
          return NextResponse.json({
            jsonrpc: '2.0',
            error: { code: -32602, message: 'context is required' },
            id,
          });
        }
        try {
          const hits = await runSearch(query, context as AgentContext);
          return NextResponse.json({
            jsonrpc: '2.0',
            result: {
              content: [{ type: 'text', text: JSON.stringify(hits, null, 2) }],
            },
            id,
          });
        } catch (err) {
          return mcpError(id, err);
        }
      }

      return NextResponse.json({
        jsonrpc: '2.0',
        error: { code: -32601, message: `Tool ${name} not found` },
        id,
      });
    }

    return NextResponse.json({
      jsonrpc: '2.0',
      error: { code: -32601, message: `Method ${method} not found` },
      id,
    });
  } catch (error) {
    console.error('MCP error:', error);
    return NextResponse.json(
      {
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal error' },
        id: null,
      },
      { status: 500 },
    );
  }
}

async function runSearch(query: string, context: AgentContext) {
  const out: any[] = [];
  if (canAccessMemory(context, 'own')) {
    const own = await searchOwnMemory(query, { limit: 5 });
    own.forEach((m) => out.push({ ...m, scope: 'own' }));
  }
  if (canAccessMemory(context, 'user') && context.userId) {
    const u = await searchUserMemory(context.userId, query, { limit: 5 });
    u.forEach((m) => out.push({ ...m, scope: 'user' }));
  }
  if (canAccessMemory(context, 'space')) {
    const s = await searchSpaceMemory(context.spaceId, query, { limit: 5 });
    s.forEach((m) => out.push({ ...m, scope: 'space' }));
  }
  if (canAccessMemory(context, 'service')) {
    const svc = await searchServiceMemory(context.serviceId, query, { limit: 5 });
    svc.forEach((m) => out.push({ ...m, scope: 'service' }));
  }
  return out;
}

function mcpError(id: any, err: unknown) {
  if (err instanceof PolicyError) {
    return NextResponse.json({
      jsonrpc: '2.0',
      error: { code: -32602, message: err.message, data: { code: err.code } },
      id,
    });
  }
  // Surface the real error message so the caller can debug – but keep
  // a generic code per JSON‑RPC conventions.
  const message = err instanceof Error ? err.message : String(err);
  console.error('[mcp] unexpected', err);
  return NextResponse.json({
    jsonrpc: '2.0',
    error: { code: -32603, message: `Internal error: ${message}` },
    id,
  });
}
