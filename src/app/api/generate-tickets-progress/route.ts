// /api/tickets/progress/route.ts
import { NextRequest, NextResponse } from 'next/server';

// Progress tracking interface
interface ProgressData {
  current: number;
  total: number;
  completed: boolean;
  lastUpdated: number;
  failed?: number;
  successful?: number;
}

// Global progress store
declare global {
  var batchProgress: Record<string, ProgressData> | undefined;
}

export async function GET(request: NextRequest) {
  try {
    const sessionId = request.nextUrl.searchParams.get('sessionId');

    if (!sessionId) {
      return NextResponse.json({
        error: 'Session ID required',
        code: 'MISSING_SESSION_ID'
      }, { status: 400 });
    }

    // Get progress from global store
    const progress = global.batchProgress?.[sessionId];

    if (!progress) {
      return NextResponse.json({
        error: 'Progress not found or expired',
        code: 'PROGRESS_NOT_FOUND'
      }, { status: 404 });
    }

    // Auto-cleanup if completed more than 5 minutes ago
    if (progress.completed && Date.now() - progress.lastUpdated > 5 * 60 * 1000) {
      delete global.batchProgress![sessionId];
      return NextResponse.json({
        error: 'Progress expired',
        code: 'PROGRESS_EXPIRED'
      }, { status: 404 });
    }

    // Cleanup old progress data (older than 1 hour)
    if (global.batchProgress) {
      const oneHourAgo = Date.now() - 60 * 60 * 1000;
      for (const [key, data] of Object.entries(global.batchProgress)) {
        if (data.lastUpdated < oneHourAgo) {
          delete global.batchProgress[key];
        }
      }
    }

    return NextResponse.json({
      current: progress.current,
      total: progress.total,
      completed: progress.completed,
      failed: progress.failed || 0,
      successful: progress.successful || 0,
      percentage: Math.round((progress.current / progress.total) * 100),
      lastUpdated: progress.lastUpdated,
      estimatedTimeRemaining: calculateEstimatedTime(progress)
    });

  } catch (error: any) {
    console.error('Get progress error:', error);
    return NextResponse.json({
      error: 'Failed to get progress',
      code: 'INTERNAL_ERROR',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { sessionId, current, total, completed, failed, successful } = await request.json();

    if (!sessionId) {
      return NextResponse.json({
        error: 'Session ID required',
        code: 'MISSING_SESSION_ID'
      }, { status: 400 });
    }

    // Initialize global store if needed
    global.batchProgress = global.batchProgress || {};

    // Update progress
    global.batchProgress[sessionId] = {
      current: current || 0,
      total: total || 0,
      completed: !!completed,
      failed: failed || 0,
      successful: successful || 0,
      lastUpdated: Date.now()
    };

    // Auto-cleanup for completed sessions after 5 minutes
    if (completed) {
      setTimeout(() => {
        if (global.batchProgress?.[sessionId]) {
          delete global.batchProgress[sessionId];
        }
      }, 5 * 60 * 1000); // 5 minutes
    }

    return NextResponse.json({
      success: true,
      sessionId,
      timestamp: Date.now()
    });

  } catch (error: any) {
    console.error('Update progress error:', error);
    return NextResponse.json({
      error: 'Failed to update progress',
      code: 'INTERNAL_ERROR'
    }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const sessionId = request.nextUrl.searchParams.get('sessionId');

    if (!sessionId) {
      return NextResponse.json({
        error: 'Session ID required',
        code: 'MISSING_SESSION_ID'
      }, { status: 400 });
    }

    // Remove progress from store
    if (global.batchProgress?.[sessionId]) {
      delete global.batchProgress[sessionId];
    }

    return NextResponse.json({
      success: true,
      message: 'Progress cleared'
    });

  } catch (error: any) {
    console.error('Delete progress error:', error);
    return NextResponse.json({
      error: 'Failed to clear progress',
      code: 'INTERNAL_ERROR'
    }, { status: 500 });
  }
}

// Helper function to calculate estimated time remaining
function calculateEstimatedTime(progress: ProgressData): number | null {
  if (progress.current === 0 || progress.total === 0) return null;

  const timePerTicket = (Date.now() - progress.lastUpdated) / (progress.current || 1);
  const remainingTickets = progress.total - progress.current;
  const estimatedMs = timePerTicket * remainingTickets;

  return Math.round(estimatedMs / 1000); // Return in seconds
}