import { NextRequest, NextResponse } from 'next/server';
import { processAgent } from '@/agent/core';
import { PROTOCOL_VERSION } from '@/agent/version';
import { PolicyError } from '@/policy';
import {
  assertScope,
  authenticateServiceRequest,
  hasScope,
  ServiceAuthError,
} from '@/auth/service-auth';
import { publicContextSchema } from '@/transport/schemas';
import type { AgentAttachment, AgentContext } from '@/agent/types';

function authErrorResponse(error: ServiceAuthError) {
  const status =
    error.code === 'missing_scope' || error.code === 'service_mismatch' ? 403 : 401;
  return NextResponse.json(
    { error: { code: error.code, message: error.message } },
    { status, headers: { 'X-Agent-Version': PROTOCOL_VERSION } },
  );
}

export async function POST(request: NextRequest) {
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return NextResponse.json(
      { error: { code: 'invalid_body', message: 'Request body is required' } },
      { status: 400 },
    );
  }

  let body: {
    prompt?: unknown;
    context?: unknown;
    attachments?: unknown;
  };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json(
      { error: { code: 'invalid_json', message: 'Body must be valid JSON' } },
      { status: 400 },
    );
  }

  if (typeof body.prompt !== 'string' || body.prompt.length === 0) {
    return NextResponse.json(
      { error: { code: 'missing_prompt', message: 'prompt is required' } },
      { status: 400 },
    );
  }
  if (!body.context) {
    return NextResponse.json(
      { error: { code: 'missing_context', message: 'context is required' } },
      { status: 400 },
    );
  }
  if (body.attachments !== undefined && !Array.isArray(body.attachments)) {
    return NextResponse.json(
      {
        error: {
          code: 'invalid_attachments',
          message: 'attachments must be an array',
        },
      },
      { status: 400 },
    );
  }

  let context: AgentContext;
  try {
    context = publicContextSchema.parse(body.context) as AgentContext;
  } catch {
    return NextResponse.json(
      { error: { code: 'invalid_context', message: 'context is invalid' } },
      { status: 400 },
    );
  }

  let auth;
  try {
    auth = await authenticateServiceRequest({
      headers: request.headers,
      rawBody,
      expectedServiceId: context.serviceId,
    });
    assertScope(auth, 'agent:message');
    if (context.memoryAccess.write) assertScope(auth, 'memory:write');
  } catch (error) {
    if (error instanceof ServiceAuthError) return authErrorResponse(error);
    throw error;
  }

  const trustedContext: AgentContext = {
    ...context,
    attachments:
      (body.attachments as AgentAttachment[] | undefined) ?? context.attachments,
    identityLinks: hasScope(auth, 'identity:link')
      ? context.identityLinks
      : undefined,
    runtimeTrust: { allowIdentityLinks: hasScope(auth, 'identity:link') },
  };

  try {
    const result = await processAgent(body.prompt, trustedContext);
    return NextResponse.json(result, {
      headers: { 'X-Agent-Version': PROTOCOL_VERSION },
    });
  } catch (error) {
    if (error instanceof PolicyError) {
      const status =
        error.code === 'rate_limited'
          ? 429
          : error.code === 'write_forbidden'
            ? 403
            : 400;
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status, headers: { 'X-Agent-Version': PROTOCOL_VERSION } },
      );
    }
    console.error('[agent] unexpected error', error);
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Unexpected server error' } },
      { status: 500, headers: { 'X-Agent-Version': PROTOCOL_VERSION } },
    );
  }
}
