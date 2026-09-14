import { createHash, createHmac, timingSafeEqual } from 'crypto';

export interface ServiceAuthResult {
  serviceId: string;
  scopes: string[];
}

export class ServiceAuthError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'service_auth_unconfigured'
      | 'missing_service_auth'
      | 'unknown_service'
      | 'service_mismatch'
      | 'stale_timestamp'
      | 'invalid_signature'
      | 'missing_scope',
  ) {
    super(message);
    this.name = 'ServiceAuthError';
  }
}

interface ServiceCredential {
  secret: Buffer;
  scopes: string[];
}

const AUTH_WINDOW_MS = 5 * 60 * 1000;

function loadCredentials(): Map<string, ServiceCredential> | null {
  const raw = process.env.AGENT_SERVICE_CREDENTIALS;
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ServiceAuthError(
      'AGENT_SERVICE_CREDENTIALS must be valid JSON',
      'service_auth_unconfigured',
    );
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ServiceAuthError(
      'AGENT_SERVICE_CREDENTIALS must be an object',
      'service_auth_unconfigured',
    );
  }

  const credentials = new Map<string, ServiceCredential>();
  for (const [serviceId, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new ServiceAuthError(
        `Invalid credential for service "${serviceId}"`,
        'service_auth_unconfigured',
      );
    }
    const record = value as { secretBase64?: unknown; scopes?: unknown };
    if (typeof record.secretBase64 !== 'string' || record.secretBase64.length === 0) {
      throw new ServiceAuthError(
        `Missing secretBase64 for service "${serviceId}"`,
        'service_auth_unconfigured',
      );
    }
    if (
      record.scopes !== undefined &&
      (!Array.isArray(record.scopes) || record.scopes.some((scope) => typeof scope !== 'string'))
    ) {
      throw new ServiceAuthError(
        `Invalid scopes for service "${serviceId}"`,
        'service_auth_unconfigured',
      );
    }

    credentials.set(serviceId, {
      secret: Buffer.from(record.secretBase64, 'base64'),
      scopes: (record.scopes as string[] | undefined) ?? [],
    });
  }
  return credentials;
}

export function createServiceSignature(input: {
  secret: string | Buffer;
  timestamp: string;
  serviceId: string;
  rawBody: string;
}): string {
  const bodyHash = createHash('sha256').update(input.rawBody, 'utf8').digest('hex');
  return createHmac('sha256', input.secret)
    .update(`${input.timestamp}\n${input.serviceId}\n${bodyHash}`, 'utf8')
    .digest('hex');
}

function secureHexEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function hasScope(auth: ServiceAuthResult, scope: string): boolean {
  return auth.scopes.includes('*') || auth.scopes.includes(scope);
}

export function assertScope(auth: ServiceAuthResult, scope: string): void {
  if (!hasScope(auth, scope)) {
    throw new ServiceAuthError(
      `Service "${auth.serviceId}" is missing required scope "${scope}"`,
      'missing_scope',
    );
  }
}

export async function authenticateServiceRequest(input: {
  headers: Headers;
  rawBody: string;
  expectedServiceId?: string;
}): Promise<ServiceAuthResult> {
  const credentials = loadCredentials();
  const headerService = input.headers.get('x-agent-service');

  if (!credentials) {
    return {
      serviceId: input.expectedServiceId ?? headerService ?? 'development',
      scopes: ['*'],
    };
  }

  const timestamp = input.headers.get('x-agent-timestamp');
  const signature = input.headers.get('x-agent-signature');
  if (!headerService || !timestamp || !signature) {
    throw new ServiceAuthError(
      'X-Agent-Service, X-Agent-Timestamp, and X-Agent-Signature are required',
      'missing_service_auth',
    );
  }

  if (input.expectedServiceId && headerService !== input.expectedServiceId) {
    throw new ServiceAuthError(
      'Authenticated service does not match context.serviceId',
      'service_mismatch',
    );
  }

  const credential = credentials.get(headerService);
  if (!credential) {
    throw new ServiceAuthError(`Unknown service "${headerService}"`, 'unknown_service');
  }

  const timestampMs = Number(timestamp);
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > AUTH_WINDOW_MS) {
    throw new ServiceAuthError('Signature timestamp is outside the allowed window', 'stale_timestamp');
  }

  const expectedSignature = createServiceSignature({
    secret: credential.secret,
    timestamp,
    serviceId: headerService,
    rawBody: input.rawBody,
  });
  if (!secureHexEqual(signature.toLowerCase(), expectedSignature)) {
    throw new ServiceAuthError('Invalid service signature', 'invalid_signature');
  }

  return { serviceId: headerService, scopes: credential.scopes };
}
