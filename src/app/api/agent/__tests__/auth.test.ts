jest.mock('../../../../agent/core', () => ({
  processAgent: jest.fn(async (_prompt: string, context: import('@/agent/types').AgentContext) => ({
    text: 'ok',
    type: 'message',
    metadata: {
      serviceId: context.serviceId,
      identityLinks: context.identityLinks,
      runtimeTrust: context.runtimeTrust,
    },
  })),
}));

import { NextRequest } from 'next/server';
import { createServiceSignature } from '@/auth/service-auth';
import { processAgent } from '@/agent/core';
import { POST } from '../route';

const mockedProcessAgent = jest.mocked(processAgent);
const secret = Buffer.from('route-secret');
const secretBase64 = secret.toString('base64');

function signedRequest(body: unknown, serviceId = 'svc') {
  const rawBody = JSON.stringify(body);
  const timestamp = String(Date.now());
  const signature = createServiceSignature({
    secret,
    timestamp,
    serviceId,
    rawBody,
  });
  return new NextRequest('http://localhost/api/agent', {
    method: 'POST',
    body: rawBody,
    headers: {
      'content-type': 'application/json',
      'x-agent-service': serviceId,
      'x-agent-timestamp': timestamp,
      'x-agent-signature': signature,
    },
  });
}

const baseBody = {
  prompt: 'hello',
  context: {
    source: 'http',
    serviceId: 'svc',
    spaceId: 'space',
    userId: 'user-1',
    globalUserId: 'spoofed-global',
    vaultId: 'spoofed-vault',
    identityLinks: [{ serviceId: 'other', userId: 'other-user' }],
    trigger: 'mention',
    responseMode: 'private',
    memoryAccess: {
      own: false,
      user: true,
      space: false,
      service: false,
      write: false,
    },
  },
};

describe('/api/agent service auth', () => {
  beforeEach(() => {
    mockedProcessAgent.mockClear();
  });

  afterEach(() => {
    delete process.env.AGENT_SERVICE_CREDENTIALS;
  });

  it('accepts a valid request and strips untrusted identity fields', async () => {
    process.env.AGENT_SERVICE_CREDENTIALS = JSON.stringify({
      svc: { secretBase64, scopes: ['agent:message', 'memory:read'] },
    });

    const response = await POST(signedRequest(baseBody));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.metadata.identityLinks).toBeUndefined();
    expect(json.metadata.runtimeTrust).toEqual({ allowIdentityLinks: false });
    expect(mockedProcessAgent.mock.calls[0][1].globalUserId).toBeUndefined();
    expect(mockedProcessAgent.mock.calls[0][1].vaultId).toBeUndefined();
  });

  it('rejects an invalid signature', async () => {
    process.env.AGENT_SERVICE_CREDENTIALS = JSON.stringify({
      svc: { secretBase64, scopes: ['agent:message'] },
    });
    const request = signedRequest(baseBody);
    request.headers.set('x-agent-signature', '0'.repeat(64));

    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json.error.code).toBe('invalid_signature');
    expect(mockedProcessAgent).not.toHaveBeenCalled();
  });

  it('rejects writes without memory:write scope', async () => {
    process.env.AGENT_SERVICE_CREDENTIALS = JSON.stringify({
      svc: { secretBase64, scopes: ['agent:message'] },
    });

    const response = await POST(
      signedRequest({
        ...baseBody,
        context: {
          ...baseBody.context,
          memoryAccess: { ...baseBody.context.memoryAccess, write: true },
        },
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(403);
    expect(json.error.code).toBe('missing_scope');
    expect(mockedProcessAgent).not.toHaveBeenCalled();
  });
});
