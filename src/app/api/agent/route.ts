/**
 * HTTP transport for the cf-kristina agent runtime.
 *
 * External services (Sfera, news sites, chat bots) that do not use the
 * MCP protocol can call this endpoint to talk to Kristina.  The
 * request shape mirrors what MCP `agent_message` expects, so the same
 * adapter can later switch transports without code changes.
 *
 * Response is a JSON `AgentResult`; failures are returned as structured
 * JSON with an `error.code` so the caller can act programmatically.
 */

import { NextRequest, NextResponse } from 'next/server';
import { processAgent } from '@/agent/core';
import { PROTOCOL_VERSION } from '@/agent/version';
import { PolicyError } from '@/policy';
import type { AgentContext } from '@/agent/types';

export async function POST(request: NextRequest) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'invalid_json', message: 'Body must be valid JSON' } },
      { status: 400 },
    );
  }

  const { prompt, context } = body || {};
  if (typeof prompt !== 'string' || prompt.length === 0) {
    return NextResponse.json(
      { error: { code: 'missing_prompt', message: 'prompt is required' } },
      { status: 400 },
    );
  }
  if (!context) {
    return NextResponse.json(
      { error: { code: 'missing_context', message: 'context is required' } },
      { status: 400 },
    );
  }

  try {
    const result = await processAgent(prompt, context as AgentContext);
    return NextResponse.json(result, {
      headers: { 'X-Agent-Version': PROTOCOL_VERSION },
    });
  } catch (err) {
    if (err instanceof PolicyError) {
      const status =
        err.code === 'rate_limited' ? 429 :
        err.code === 'write_forbidden' ? 403 : 400;
      return NextResponse.json(
        { error: { code: err.code, message: err.message } },
        { status, headers: { 'X-Agent-Version': PROTOCOL_VERSION } },
      );
    }
    console.error('[agent] unexpected error', err);
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Unexpected server error' } },
      { status: 500, headers: { 'X-Agent-Version': PROTOCOL_VERSION } },
    );
  }
}
