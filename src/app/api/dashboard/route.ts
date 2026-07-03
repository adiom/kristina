import { NextRequest, NextResponse } from 'next/server';
import { getAgentDashboard, getExtendedDashboard } from '../../../dashboard';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const extended = searchParams.get('extended') === '1';

    const base = await getAgentDashboard();
    if (!extended) {
      return NextResponse.json(base);
    }

    const ext = await getExtendedDashboard();
    return NextResponse.json({ ...base, extended: ext });
  } catch (error) {
    console.error('[Dashboard] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch dashboard data' },
      { status: 500 }
    );
  }
}
