import { NextResponse } from 'next/server';
import { getAgentDashboard } from '../../../dashboard';

export async function GET() {
  try {
    const dashboard = await getAgentDashboard();
    return NextResponse.json(dashboard);
  } catch (error) {
    console.error('[Dashboard] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch dashboard data' },
      { status: 500 }
    );
  }
}
