import { NextResponse } from 'next/server';
import { PROTOCOL_VERSION } from '@/agent/version';
import {
  assertScope,
  authenticateServiceRequest,
  ServiceAuthError,
} from '@/auth/service-auth';
import { PolicyError } from '@/policy';
import { publicContextSchema } from '@/transport/schemas';
import type { AgentContext } from '@/agent/types';

export interface MemoryRequestBody {
  query?: unknown;
  memoryId?: unknown;
  exact?: unknown;
  context?: unknown;
}

export async function parseMemoryRequest(request: Request): Promise<{
  rawBody: string;
  body: MemoryRequestBody;
  context: AgentContext;
} | NextResponse> {
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return NextResponse.json(
      { error: { code: 'invalid_body', message: 'Request body is required' } },
      { status: 400 },
    );
  }

  let body: MemoryRequestBody;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json(
      { error: { code: 'invalid_json', message: 'Body must be valid JSON' } },
      { status: 400 },
    );
  }

  if (!body.context) {
    return NextResponse.json(
      { error: { code: 'missing_context', message: 'context is required' } },
      { status: 400 },
    );
  }

  try {
    return {
      rawBody,
      body,
      context: publicContextSchema.parse(body.context) as AgentContext,
    };
  } catch {
    return NextResponse.json(
      { error: { code: 'invalid_context', message: 'context is invalid' } },
      { status: 400 },
    );
  }
}

export async function authorizeMemoryRequest(
  request: Request,
  rawBody: string,
  context: AgentContext,
  write: boolean,
): Promise<NextResponse | null> {
  try {
    const auth = await authenticateServiceRequest({
      headers: request.headers,
      rawBody,
      expectedServiceId: context.serviceId,
    });
    assertScope(auth, write ? 'memory:write' : 'memory:read');
    return null;
  } catch (error) {
    if (!(error instanceof ServiceAuthError)) throw error;
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      {
        status:
          error.code === 'missing_scope' || error.code === 'service_mismatch'
            ? 403
            : 401,
        headers: { 'X-Agent-Version': PROTOCOL_VERSION },
      },
    );
  }
}

export function memoryErrorResponse(error: unknown) {
  if (error instanceof PolicyError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status: error.code === 'write_forbidden' ? 403 : 400 },
    );
  }
  console.error('[memory-api] unexpected error', error);
  return NextResponse.json(
    { error: { code: 'internal_error', message: 'Unexpected server error' } },
    { status: 500 },
  );
}
