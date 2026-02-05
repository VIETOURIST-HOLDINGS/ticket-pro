// /api/generate-tickets-batch/route.ts
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import QRCode from 'qrcode';
import sharp from 'sharp';
import archiver from 'archiver';

// ⭐ Config for QR code - ĐIỀU CHỈNH Ở ĐÂY
const TICKET_CONFIG = {
  template: 'ticket.jpg',
  qrCode: {
    size: 2800,
    position: {
      x: 9650,
      y: 2500
    },
    color: {
      dark: '#000000',
      light: '#FFFFFF'
    },
    margin: 1
  }
};


// Progress tracking store
interface ProgressData {
  current: number;
  total: number;
  completed: boolean;
  lastUpdated: number;
}

declare global {
  var batchProgress: Record<string, ProgressData> | undefined;
}

export async function POST(request: NextRequest) {
  try {
    const { tickets, sessionId } = await request.json();

    if (!tickets || !Array.isArray(tickets) || tickets.length === 0) {
      return NextResponse.json(
        { error: 'Tickets array is required' },
        { status: 400 }
      );
    }

    if (!sessionId) {
      return NextResponse.json(
        { error: 'Session ID is required for progress tracking' },
        { status: 400 }
      );
    }

    // Initialize progress tracking
    global.batchProgress = global.batchProgress || {};
    const initializeProgress = () => {
      global.batchProgress![sessionId] = {
        current: 0,
        total: tickets.length,
        completed: false,
        lastUpdated: Date.now()
      };
    };

    const updateProgress = (current: number, completed = false) => {
      if (global.batchProgress?.[sessionId]) {
        global.batchProgress[sessionId] = {
          current,
          total: tickets.length,
          completed,
          lastUpdated: Date.now()
        };
      }
    };

    initializeProgress();

    // Check if template exists
    const templatePath = path.join(process.cwd(), 'public', TICKET_CONFIG.template);
    if (!fs.existsSync(templatePath)) {
      return NextResponse.json(
        {
          error: `Template file not found: ${TICKET_CONFIG.template}`,
          suggestion: 'Place your template in /public/ticket.jpg'
        },
        { status: 404 }
      );
    }

    // Read template once for better performance
    const templateBuffer = fs.readFileSync(templatePath);

    // Create ZIP archive
    const archive = archiver('zip', {
      zlib: { level: 6 } // Balanced compression
    });

    const chunks: Buffer[] = [];
    let archiveEnded = false;

    const archivePromise = new Promise<void>((resolve, reject) => {
      archive.on('end', () => {
        archiveEnded = true;
        resolve();
      });
      archive.on('error', reject);
      archive.on('data', (chunk) => chunks.push(chunk));
    });

    // Start progress
    updateProgress(0);

    // Process tickets in batches for memory efficiency
    const BATCH_SIZE = 3; // Smaller batch for JPG processing
    let processedCount = 0;
    let failedTickets: Array<{ rowNumber: number; error: string }> = [];

    for (let i = 0; i < tickets.length; i += BATCH_SIZE) {
      const batch = tickets.slice(i, Math.min(i + BATCH_SIZE, tickets.length));

      const batchPromises = batch.map(async (ticket) => {
        try {
          // ⭐ Generate QR code for this ticket
          // ⭐ Generate QR code SVG (NO BORDER)
          const qrSvg = await QRCode.toString(ticket.qrData, {
            type: 'svg',
            width: TICKET_CONFIG.qrCode.size,
            margin: TICKET_CONFIG.qrCode.margin,
            color: {
              dark: TICKET_CONFIG.qrCode.color.dark,
              light: TICKET_CONFIG.qrCode.color.light
            }
          });

          // Convert SVG to buffer
          const qrBuffer = Buffer.from(qrSvg);


          // ⭐ Create final ticket image
          const finalImage = await sharp(templateBuffer)
            .composite([{
              input: qrBuffer,
              left: TICKET_CONFIG.qrCode.position.x,
              top: TICKET_CONFIG.qrCode.position.y,
            }])
            .jpeg({
              quality: 85,
              mozjpeg: true
            })
            .toBuffer();


          // ⭐ Add to ZIP
          const filename = ticket.rowData?.name
            ? `${ticket.rowData.name.replace(/[^a-z0-9]/gi, '_')}.jpg`
            : `ticket_${ticket.rowNumber || processedCount + 1}.jpg`;

          archive.append(finalImage, { name: filename });

          processedCount++;
          updateProgress(processedCount);

          return { success: true, filename };

        } catch (error: any) {
          console.error(`Error processing ticket ${ticket.rowNumber}:`, error);
          failedTickets.push({
            rowNumber: ticket.rowNumber,
            error: error.message
          });

          processedCount++;
          updateProgress(processedCount);

          return { success: false, error: error.message };
        }
      });

      await Promise.all(batchPromises);

      // Small delay between batches to prevent memory spike
      if (i + BATCH_SIZE < tickets.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    // Finalize archive
    archive.finalize();
    await archivePromise;

    // Mark as completed
    updateProgress(tickets.length, true);

    // Combine chunks
    const zipBuffer = Buffer.concat(chunks);

    // Cleanup old progress data (older than 1 hour)
    if (global.batchProgress) {
      const oneHourAgo = Date.now() - 60 * 60 * 1000;
      for (const [key, data] of Object.entries(global.batchProgress)) {
        if (data.lastUpdated < oneHourAgo) {
          delete global.batchProgress[key];
        }
      }
    }

    console.log(`✅ Generated ${tickets.length} tickets, failed: ${failedTickets.length}`);

    return new NextResponse(zipBuffer, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="tickets_${Date.now()}.zip"`,
        'Content-Length': zipBuffer.length.toString(),
        'X-Tickets-Generated': tickets.length.toString(),
        'X-Tickets-Failed': failedTickets.length.toString(),
      },
    });

  } catch (error: any) {
    console.error('Generate tickets batch error:', error);

    // Cleanup progress on error
    if (sessionId && global.batchProgress?.[sessionId]) {
      delete global.batchProgress[sessionId];
    }

    return NextResponse.json(
      {
        error: 'Failed to generate tickets batch',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      },
      { status: 500 }
    );
  }
}

// ⭐ API để lấy progress
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('sessionId');

    if (!sessionId) {
      return NextResponse.json(
        { error: 'Session ID is required' },
        { status: 400 }
      );
    }

    const progress = global.batchProgress?.[sessionId];

    if (!progress) {
      return NextResponse.json(
        { error: 'Progress not found or expired' },
        { status: 404 }
      );
    }

    // Clean up if completed more than 5 minutes ago
    if (progress.completed && Date.now() - progress.lastUpdated > 5 * 60 * 1000) {
      delete global.batchProgress![sessionId];
    }

    return NextResponse.json({
      current: progress.current,
      total: progress.total,
      completed: progress.completed,
      percentage: Math.round((progress.current / progress.total) * 100),
      lastUpdated: progress.lastUpdated
    });

  } catch (error) {
    console.error('Get progress error:', error);
    return NextResponse.json(
      { error: 'Failed to get progress' },
      { status: 500 }
    );
  }
}