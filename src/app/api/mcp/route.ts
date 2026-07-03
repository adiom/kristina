import { NextRequest, NextResponse } from 'next/server';
import { createAgent } from '@/agent/core';
import { searchOwnMemory } from '@/memory/store';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { method, params, id } = body;

    if (method === 'initialize') {
      return NextResponse.json({
        jsonrpc: '2.0',
        result: {
          protocolVersion: '2025-03-26',
          capabilities: {
            tools: { listChanged: false },
          },
          serverInfo: {
            name: 'cf-kristina',
            version: '1.0.0',
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
              name: 'send_message',
              description: 'Отправить сообщение в чат Авроры Сферы',
              inputSchema: {
                type: 'object',
                properties: {
                  text: { type: 'string', description: 'Текст сообщения' },
                },
                required: ['text'],
              },
            },
            {
              name: 'search_memory',
              description: 'Поиск в памяти агента',
              inputSchema: {
                type: 'object',
                properties: {
                  query: { type: 'string', description: 'Поисковый запрос' },
                  userId: { type: 'string', description: 'ID пользователя (необязательно)' },
                },
                required: ['query'],
              },
            },
          ],
        },
        id,
      });
    }

    if (method === 'tools/call') {
      const { name, arguments: args } = params;
      
      if (name === 'search_memory') {
        const { query, userId } = args;
        const results = await searchOwnMemory(query);
        return NextResponse.json({
          jsonrpc: '2.0',
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify(results.map(r => ({
                  content: r.content,
                  category: r.category,
                  similarity: r.similarity,
                })), null, 2),
              },
            ],
          },
          id,
        });
      }

      if (name === 'send_message') {
        const { message, text } = args;
        const prompt = message || text;
        const agent = createAgent();
        const result = await agent.generate({ prompt });
        return NextResponse.json({
          jsonrpc: '2.0',
          result: {
            content: [
              {
                type: 'text',
                text: result.text,
              },
            ],
          },
          id,
        });
      }

      return NextResponse.json({
        jsonrpc: '2.0',
        error: {
          code: -32601,
          message: `Tool ${name} not found`,
        },
        id,
      });
    }

    return NextResponse.json({
      jsonrpc: '2.0',
      error: {
        code: -32601,
        message: `Method ${method} not found`,
      },
      id,
    });
  } catch (error) {
    console.error('MCP error:', error);
    return NextResponse.json(
      {
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal error',
        },
        id: null,
      },
      { status: 500 }
    );
  }
}
