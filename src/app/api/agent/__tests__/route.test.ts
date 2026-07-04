jest.mock('../../../../agent/core', () => ({
  processAgent: jest.fn(async (_prompt: string, context: any) => ({
    text: 'ok',
    type: 'message',
    metadata: {
      attachments: context.attachments ?? [],
    },
  })),
}));

import { NextRequest } from 'next/server';
import { POST } from '../route';

describe('/api/agent route', () => {
  it('passes top-level attachments into processAgent context', async () => {
    const request = new NextRequest('http://localhost:31337/api/agent', {
      method: 'POST',
      body: JSON.stringify({
        prompt: 'проверь файл',
        context: {
          source: 'http',
          serviceId: 'svc',
          spaceId: 'space',
          trigger: 'mention',
          responseMode: 'public',
          memoryAccess: {
            own: true,
            user: true,
            space: true,
            service: true,
            write: true,
          },
        },
        attachments: [
          {
            type: 'document',
            source: 'storage',
            title: 'brief.pdf',
            storageKey: 'vaults/u1/brief.pdf',
          },
        ],
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.metadata.attachments).toEqual([
      {
        type: 'document',
        source: 'storage',
        title: 'brief.pdf',
        storageKey: 'vaults/u1/brief.pdf',
      },
    ]);
  });

  it('rejects non-array attachments', async () => {
    const request = new NextRequest('http://localhost:31337/api/agent', {
      method: 'POST',
      body: JSON.stringify({
        prompt: 'проверь файл',
        context: {
          source: 'http',
          serviceId: 'svc',
          spaceId: 'space',
          trigger: 'mention',
          responseMode: 'public',
          memoryAccess: {
            own: true,
            user: true,
            space: true,
            service: true,
            write: true,
          },
        },
        attachments: { bad: true },
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
  });
});
