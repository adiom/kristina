jest.mock('@/memory/control', () => ({
  searchMemoryControl: jest.fn(),
  forgetMemoryControl: jest.fn(),
  confirmMemoryControl: jest.fn(),
  memoryStatusControl: jest.fn(),
}));

import { PolicyError } from '@/policy';
import { forgetMemoryControl } from '@/memory/control';
import { POST as forget } from '../forget/route';
import { POST as search } from '../search/route';

const mockedForget = jest.mocked(forgetMemoryControl);

const context = {
  source: 'http' as const,
  serviceId: 'svc',
  spaceId: 'space',
  userId: 'user-1',
  trigger: 'command' as const,
  responseMode: 'private' as const,
  memoryAccess: {
    own: false,
    user: true,
    space: false,
    service: false,
    write: true,
  },
};

function request(path: string, body: unknown) {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('memory control API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.AGENT_SERVICE_CREDENTIALS;
  });

  it('requires a query for search', async () => {
    const response = await search(
      request('/api/memory/search', { context }),
    );
    expect(response.status).toBe(400);
  });

  it('rejects forget when memory writes are forbidden', async () => {
    mockedForget.mockRejectedValue(
      new PolicyError('Memory writes are disabled', 'write_forbidden'),
    );

    const response = await forget(
      request('/api/memory/forget', {
        query: 'я люблю кофе',
        context: {
          ...context,
          memoryAccess: { ...context.memoryAccess, write: false },
        },
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(403);
    expect(json.error.code).toBe('write_forbidden');
  });
});
