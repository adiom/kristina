import {
  assertScope,
  authenticateServiceRequest,
  createServiceSignature,
  ServiceAuthError,
} from '../service-auth';

const secret = Buffer.from('test-service-secret');
const secretBase64 = secret.toString('base64');

function authHeaders(serviceId = 'svc', timestamp = Date.now()) {
  return new Headers({
    'x-agent-service': serviceId,
    'x-agent-timestamp': String(timestamp),
  });
}

function sign(serviceId: string, timestamp: string, rawBody: string) {
  return createServiceSignature({ secret, timestamp, serviceId, rawBody });
}

describe('service auth', () => {
  afterEach(() => {
    delete process.env.AGENT_SERVICE_CREDENTIALS;
  });

  it('accepts a valid HMAC signature', async () => {
    const rawBody = '{"prompt":"hello"}';
    const timestamp = String(Date.now());
    const headers = authHeaders('svc', Number(timestamp));
    headers.set('x-agent-signature', sign('svc', timestamp, rawBody));
    process.env.AGENT_SERVICE_CREDENTIALS = JSON.stringify({
      svc: { secretBase64, scopes: ['agent:message'] },
    });

    const auth = await authenticateServiceRequest({
      headers,
      rawBody,
      expectedServiceId: 'svc',
    });

    expect(auth).toEqual({ serviceId: 'svc', scopes: ['agent:message'] });
  });

  it('rejects an invalid signature', async () => {
    const rawBody = '{"prompt":"hello"}';
    const headers = authHeaders();
    headers.set('x-agent-signature', '0'.repeat(64));
    process.env.AGENT_SERVICE_CREDENTIALS = JSON.stringify({
      svc: { secretBase64, scopes: ['agent:message'] },
    });

    await expect(
      authenticateServiceRequest({ headers, rawBody, expectedServiceId: 'svc' }),
    ).rejects.toMatchObject({ code: 'invalid_signature' });
  });

  it('rejects a stale timestamp', async () => {
    const rawBody = '{}';
    const timestamp = String(Date.now() - 6 * 60 * 1000);
    const headers = authHeaders('svc', Number(timestamp));
    headers.set('x-agent-signature', sign('svc', timestamp, rawBody));
    process.env.AGENT_SERVICE_CREDENTIALS = JSON.stringify({
      svc: { secretBase64, scopes: ['agent:message'] },
    });

    await expect(
      authenticateServiceRequest({ headers, rawBody, expectedServiceId: 'svc' }),
    ).rejects.toMatchObject({ code: 'stale_timestamp' });
  });

  it('rejects a service mismatch', async () => {
    const rawBody = '{}';
    const timestamp = String(Date.now());
    const headers = authHeaders('svc-a', Number(timestamp));
    headers.set('x-agent-signature', sign('svc-a', timestamp, rawBody));
    process.env.AGENT_SERVICE_CREDENTIALS = JSON.stringify({
      'svc-a': { secretBase64, scopes: ['agent:message'] },
    });

    await expect(
      authenticateServiceRequest({ headers, rawBody, expectedServiceId: 'svc-b' }),
    ).rejects.toMatchObject({ code: 'service_mismatch' });
  });

  it('enforces scopes', () => {
    const auth = { serviceId: 'svc', scopes: ['memory:read'] };
    expect(() => assertScope(auth, 'memory:read')).not.toThrow();
    expect(() => assertScope(auth, 'identity:link')).toThrow(ServiceAuthError);
  });
});
