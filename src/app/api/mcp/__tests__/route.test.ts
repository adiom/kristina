jest.mock('@/agent/core', () => ({
  processAgent: jest.fn(),
}));

jest.mock('@/memory/control', () => ({
  searchMemoryControl: jest.fn(),
  forgetMemoryControl: jest.fn(),
  confirmMemoryControl: jest.fn(),
  memoryStatusControl: jest.fn(),
}));

jest.mock('@/memory/store', () => ({
  searchOwnMemory: jest.fn(),
  searchSpaceMemory: jest.fn(),
  searchServiceMemory: jest.fn(),
}));

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { processAgent } from '@/agent/core';
import { PROTOCOL_VERSION } from '@/agent/version';
import {
  forgetMemoryControl,
  searchMemoryControl,
} from '@/memory/control';
import {
  searchOwnMemory,
  searchServiceMemory,
  searchSpaceMemory,
} from '@/memory/store';
import { POST } from '../route';

const mockedProcessAgent = jest.mocked(processAgent);
const mockedSearchMemoryControl = jest.mocked(searchMemoryControl);
const mockedForgetMemoryControl = jest.mocked(forgetMemoryControl);
const mockedSearchOwnMemory = jest.mocked(searchOwnMemory);
const mockedSearchSpaceMemory = jest.mocked(searchSpaceMemory);
const mockedSearchServiceMemory = jest.mocked(searchServiceMemory);

const context = {
  source: 'http' as const,
  serviceId: 'mcp-test',
  spaceId: 'space-1',
  userId: 'user-1',
  trigger: 'command' as const,
  responseMode: 'private' as const,
  memoryAccess: {
    own: true,
    user: true,
    space: true,
    service: true,
    write: false,
  },
};

function mcpRequest(body: unknown, protocolVersion?: string) {
  const headers = new Headers({
    accept: 'application/json, text/event-stream',
    'content-type': 'application/json',
  });
  if (protocolVersion) {
    headers.set('mcp-protocol-version', protocolVersion);
  }
  return new Request('http://localhost/api/mcp', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

async function responseJson(response: Response) {
  return JSON.parse(await response.text());
}

describe('MCP Streamable HTTP route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('negotiates an MCP protocol version during initialize', async () => {
    const response = await POST(
      mcpRequest(
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'jest', version: '1.0.0' },
          },
        },
        '2025-06-18',
      ),
    );
    const body = await responseJson(response);

    expect(response.status).toBe(200);
    expect(body.result.protocolVersion).toBe('2025-06-18');
    expect(body.result.serverInfo).toEqual({
      name: 'kristina',
      version: PROTOCOL_VERSION,
    });
  });

  it('lists the public and memory-control tools', async () => {
    const response = await POST(
      mcpRequest(
        { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
        '2025-06-18',
      ),
    );
    const body = await responseJson(response);

    expect(response.status).toBe(200);
    expect(body.result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      'agent_info',
      'agent_message',
      'agent_search',
      'agent_memory_search',
      'agent_memory_forget',
      'agent_memory_confirm',
      'agent_memory_status',
    ]);
  });

  it('calls agent_info through the SDK tool handler', async () => {
    const response = await POST(
      mcpRequest(
        {
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: { name: 'agent_info', arguments: {} },
        },
        '2025-06-18',
      ),
    );
    const body = await responseJson(response);
    const info = JSON.parse(body.result.content[0].text);

    expect(response.status).toBe(200);
    expect(info.version).toBe(PROTOCOL_VERSION);
    expect(info.capabilities.memoryControl).toBe(true);
  });

  it('validates and forwards agent_message arguments', async () => {
    mockedProcessAgent.mockResolvedValue({ text: 'Привет', type: 'message' });

    const response = await POST(
      mcpRequest(
        {
          jsonrpc: '2.0',
          id: 4,
          method: 'tools/call',
          params: {
            name: 'agent_message',
            arguments: { prompt: 'Привет', context },
          },
        },
        '2025-06-18',
      ),
    );
    const body = await responseJson(response);

    expect(response.status).toBe(200);
    expect(mockedProcessAgent).toHaveBeenCalledWith(
      'Привет',
      expect.objectContaining({
        ...context,
        runtimeTrust: { allowIdentityLinks: true },
      }),
    );
    expect(JSON.parse(body.result.content[0].text)).toEqual({
      text: 'Привет',
      type: 'message',
    });
  });

  it('searches only namespaces enabled by the context', async () => {
    mockedSearchOwnMemory.mockResolvedValue([{ id: 'own-1' }] as never);
    mockedSearchMemoryControl.mockResolvedValue([{ id: 'user-1' }] as never);
    mockedSearchSpaceMemory.mockResolvedValue([{ id: 'space-1' }] as never);
    mockedSearchServiceMemory.mockResolvedValue([{ id: 'service-1' }] as never);

    const response = await POST(
      mcpRequest(
        {
          jsonrpc: '2.0',
          id: 5,
          method: 'tools/call',
          params: {
            name: 'agent_search',
            arguments: {
              query: 'memory',
              context: {
                ...context,
                memoryAccess: { ...context.memoryAccess, user: false },
              },
            },
          },
        },
        '2025-06-18',
      ),
    );
    const body = await responseJson(response);
    const hits = JSON.parse(body.result.content[0].text);

    expect(response.status).toBe(200);
    expect(mockedSearchOwnMemory).toHaveBeenCalled();
    expect(mockedSearchMemoryControl).not.toHaveBeenCalled();
    expect(mockedSearchSpaceMemory).toHaveBeenCalled();
    expect(mockedSearchServiceMemory).toHaveBeenCalled();
    expect(hits.map((hit: { scope: string }) => hit.scope)).toEqual([
      'own',
      'space',
      'service',
    ]);
  });

  it('exposes personal memory search through MCP', async () => {
    mockedSearchMemoryControl.mockResolvedValue([
      { id: 'memory-1', content: 'Пользователь любит кофе' },
    ] as never);

    const response = await POST(
      mcpRequest(
        {
          jsonrpc: '2.0',
          id: 7,
          method: 'tools/call',
          params: {
            name: 'agent_memory_search',
            arguments: { query: 'кофе', context },
          },
        },
        '2025-06-18',
      ),
    );
    const body = await responseJson(response);

    expect(response.status).toBe(200);
    expect(mockedSearchMemoryControl).toHaveBeenCalledWith(
      'кофе',
      expect.objectContaining({ serviceId: 'mcp-test', userId: 'user-1' }),
    );
    expect(JSON.parse(body.result.content[0].text)[0].id).toBe('memory-1');
  });

  it('exposes personal memory forget through MCP', async () => {
    mockedForgetMemoryControl.mockResolvedValue({
      forgotten: 1,
      memoryIds: ['memory-1'],
    });

    const response = await POST(
      mcpRequest(
        {
          jsonrpc: '2.0',
          id: 8,
          method: 'tools/call',
          params: {
            name: 'agent_memory_forget',
            arguments: {
              query: 'я люблю кофе',
              exact: false,
              context: { ...context, memoryAccess: { ...context.memoryAccess, write: true } },
            },
          },
        },
        '2025-06-18',
      ),
    );
    const body = await responseJson(response);

    expect(response.status).toBe(200);
    expect(mockedForgetMemoryControl).toHaveBeenCalledWith(
      'я люблю кофе',
      expect.objectContaining({ userId: 'user-1' }),
      { exact: false },
    );
    expect(JSON.parse(body.result.content[0].text).forgotten).toBe(1);
  });

  it('returns an MCP tool error for invalid arguments', async () => {
    const response = await POST(
      mcpRequest(
        {
          jsonrpc: '2.0',
          id: 6,
          method: 'tools/call',
          params: {
            name: 'agent_message',
            arguments: { prompt: '', context },
          },
        },
        '2025-06-18',
      ),
    );
    const body = await responseJson(response);

    expect(response.status).toBe(200);
    expect(body.result.isError).toBe(true);
    expect(mockedProcessAgent).not.toHaveBeenCalled();
  });

  it('smoke tests the endpoint with a real MCP client', async () => {
    const client = new Client({
      name: 'jest-mcp-client',
      version: '1.0.0',
    });
    const transport = new StreamableHTTPClientTransport(
      new URL('http://localhost/api/mcp'),
      {
        fetch: async (url, init) =>
          POST(new Request(url, init)),
      },
    );

    await client.connect(transport);
    const tools = await client.listTools();
    await client.close();

    expect(tools.tools.map((tool) => tool.name)).toContain('agent_memory_status');
  });
});
