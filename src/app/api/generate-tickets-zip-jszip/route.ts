// /api/generate-tickets-batch/route.ts
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import QRCode from 'qrcode';
import sharp from 'sharp';
import JSZip from 'jszip';

// ⭐⭐ Config chính - ĐIỀU CHỈNH LẠI CHO ĐÚNG ⭐⭐
const TICKET_CONFIG = {
  template: 'ticket.jpg',           // Template file name
  qrCode: {
    size: 2400,
    position: {
      x: 9850,
      y: 2950
    },
    color: {
      dark: '#000000',
      light: '#FFFFFF'
    },
    margin: 1
  }

};
const ZONE_TEMPLATE_MAP: Record<string, string> = {
  'Khát Vọng': 'ticket_KV.jpg',
  'Đại Ngàn': 'ticket_DN.jpg',
  'Hành Trình Thanh Xuân': 'ticket_HTTX.jpg',
  'Ngân Vang': 'ticket_NV.jpg',
};


// Progress tracking interface
interface ProgressData {
  current: number;
  total: number;
  completed: boolean;
  lastUpdated: number;
  successful?: number;
  failed?: number;
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
    global.batchProgress[sessionId] = {
      current: 0,
      total: tickets.length,
      completed: false,
      lastUpdated: Date.now(),
      successful: 0,
      failed: 0
    };
    function createCounterSvg(
      number: number,
      options?: {
        fontSize?: number;
        opacity?: number;
        color?: string;
      }
    ) {
      const fontSize = options?.fontSize ?? 120;
      const opacity = options?.opacity ?? 0.15; // chìm chìm
      const color = options?.color ?? '#000';

      return Buffer.from(`
    <svg width="400" height="200">
      <text
        x="20"
        y="${fontSize}"
        font-size="${fontSize}"
        font-weight="700"
        fill="${color}"
        opacity="${opacity}"
        font-family="Arial, Helvetica, sans-serif"
      >
        ${number}
      </text>
    </svg>
  `);
    }


    const updateProgress = (current: number, successful?: number, failed?: number, completed = false) => {
      if (global.batchProgress?.[sessionId]) {
        const currentProgress = global.batchProgress[sessionId];
        global.batchProgress[sessionId] = {
          ...currentProgress,
          current,
          successful: successful !== undefined ? successful : currentProgress.successful,
          failed: failed !== undefined ? failed : currentProgress.failed,
          completed,
          lastUpdated: Date.now()
        };
      }
    };

    // Check if template exists
    const templatePath = path.join(process.cwd(), 'public', TICKET_CONFIG.template);
    if (!fs.existsSync(templatePath)) {
      return NextResponse.json(
        {
          error: `Template file not found: ${TICKET_CONFIG.template}`,
          suggestion: 'Place your ticket template in /public/ticket.jpg'
        },
        { status: 404 }
      );
    }

    // ⭐ Đọc metadata template để debug
    let templateWidth = 0;
    let templateHeight = 0;
    try {
      const templateMetadata = await sharp(templatePath).metadata();
      templateWidth = templateMetadata.width || 0;
      templateHeight = templateMetadata.height || 0;
      console.log(`Template size: ${templateWidth}x${templateHeight}px`);
    } catch (error) {
      console.error('Failed to read template metadata:', error);
    }

    // Read template buffer
    const templateBuffer = fs.readFileSync(templatePath);

    // Create ZIP instance
    const zip = new JSZip();


    // ⭐ Kiểm tra nếu QR vượt quá kích thước template
    if (TICKET_CONFIG.qrCode.position.x + TICKET_CONFIG.qrCode.size > templateWidth) {
      console.warn(`⚠️ QR vượt quá chiều ngang template`);
    }

    if (TICKET_CONFIG.qrCode.position.y + TICKET_CONFIG.qrCode.size > templateHeight) {
      console.warn(`⚠️ QR vượt quá chiều cao template`);
    }


    let successfulCount = 0;
    let failedCount = 0;

    // Process tickets
    const BATCH_SIZE = 2; // Even smaller batch for debugging

    for (let i = 0; i < tickets.length; i += BATCH_SIZE) {
      const batch = tickets.slice(i, Math.min(i + BATCH_SIZE, tickets.length));

      const batchPromises = batch.map(async (ticket, index) => {
        const ticketNumber = i + index + 1;
        const zone = ticket.zone;
        const templateFile =
          ZONE_TEMPLATE_MAP[zone] || TICKET_CONFIG.template; // fallback

        const templatePath = path.join(process.cwd(), 'public', templateFile);

        if (!fs.existsSync(templatePath)) {
          throw new Error(`Template not found for zone: ${zone}`);
        }

        const templateBuffer = fs.readFileSync(templatePath);


        try {
          // Validate ticket data
          if (!ticket.qrData || ticket.qrData.trim() === '') {
            throw new Error('Empty QR data');
          }

          // ⭐ Tạo QR code đơn giản hơn - chỉ QR không viền (để test)
          console.log(`Generating QR for ticket ${ticketNumber}: ${ticket.qrData.substring(0, 20)}...`);

          // Phiên bản đơn giản: QR code trực tiếp
          const qrBuffer = await QRCode.toBuffer(ticket.qrData, {
            width: TICKET_CONFIG.qrCode.size,
            margin: 1,
            color: {
              dark: TICKET_CONFIG.qrCode.color.dark,
              light: TICKET_CONFIG.qrCode.color.light
            }
          });

          // ⭐ Test: Tạo QR đơn giản không viền trước
          // const counterSvg = createCounterSvg(ticketNumber, {
          //   fontSize: 140,
          //   opacity: 0.12, // rất chìm
          //   color: '#000'
          // });

          const finalImage = await sharp(templateBuffer)
            .composite([
              // ⭐ số thứ tự – góc trái trên
              // {
              //   input: counterSvg,
              //   left: 80,  // chỉnh nhẹ nếu template khác
              //   top: 80
              // },

              // ⭐ QR code
              {
                input: qrBuffer,
                left: TICKET_CONFIG.qrCode.position.x,
                top: TICKET_CONFIG.qrCode.position.y,
              }
            ])
            .jpeg({
              quality: 90,
              mozjpeg: true
            })
            .toBuffer();


          // Tạo tên file
          let filename = `ticket_${ticket.zone}_${ticketNumber}.jpg`;

          if (ticket.rowData?.name) {
            const cleanName = ticket.rowData.name
              .replace(/[^\w\u00C0-\u024F\s]/gi, '_')
              .replace(/\s+/g, '_')
              .substring(0, 30);
            filename = `${cleanName}_${ticketNumber}.jpg`;
          }

          // Add to ZIP
          zip.file(filename, finalImage);
          successfulCount++;

          console.log(`✓ Generated ticket ${ticketNumber}: ${filename}`);

        } catch (error: any) {
          console.error(`✗ Error processing ticket ${ticketNumber}:`, error.message);
          failedCount++;

          // Create error log
          const errorContent = `Ticket ${ticketNumber} failed:\nQR: ${ticket.qrData}\nError: ${error.message}`;
          zip.file(`error_${ticketNumber}.txt`, errorContent);
        }

        // Update progress
        const current = i + index + 1;
        updateProgress(current, successfulCount, failedCount);
      });

      await Promise.all(batchPromises);

      // Small delay
      if (i + BATCH_SIZE < tickets.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }


    // Generate ZIP buffer
    console.log(`Generating ZIP file... (${successfulCount} successful, ${failedCount} failed)`);

    const zipBuffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    });

    // Mark as completed
    updateProgress(tickets.length, successfulCount, failedCount, true);

    console.log(`✅ Batch completed: ${successfulCount}/${tickets.length} tickets`);

    return new NextResponse(zipBuffer, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="tickets_${Date.now()}.zip"`,
        'Content-Length': zipBuffer.length.toString(),
      },
    });

  } catch (error: any) {
    console.error('Generate tickets batch error:', error);

    return NextResponse.json(
      {
        error: 'Failed to generate tickets batch',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      },
      { status: 500 }
    );
  }
}

// ⭐ Thêm endpoint để test template và tọa độ
export async function PUT(request: NextRequest) {
  try {
    const { qrData = 'TEST-QR-CODE-123', x, y, size } = await request.json();

    const templatePath = path.join(process.cwd(), 'public', TICKET_CONFIG.template);
    if (!fs.existsSync(templatePath)) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }

    const templateBuffer = fs.readFileSync(templatePath);

    // Use provided values or defaults
    const testQrSize = size || TICKET_CONFIG.qrCode.size;
    const testX = x || TICKET_CONFIG.qrCode.position.x;
    const testY = y || TICKET_CONFIG.qrCode.position.y;

    console.log(`Test configuration: QR ${testQrSize}px at (${testX}, ${testY})`);

    // Generate simple QR
    const qrBuffer = await QRCode.toBuffer(qrData, {
      width: testQrSize,
      margin: 1,
      color: {
        dark: '#FF0000', // Red color để dễ nhìn
        light: '#00FF00' // Green background để test
      }
    });

    // Create test image
    const testImage = await sharp(templateBuffer)
      .composite([{
        input: qrBuffer,
        left: testX,
        top: testY,
      }])
      .jpeg({ quality: 90 })
      .toBuffer();

    // Add marker for position
    const markerSvg = `
      <svg width="50" height="50">
        <circle cx="25" cy="25" r="20" fill="blue" opacity="0.5" />
        <text x="25" y="25" text-anchor="middle" fill="white" font-size="10">(${testX},${testY})</text>
      </svg>
    `;

    const finalImage = await sharp(testImage)
      .composite([{
        input: Buffer.from(markerSvg),
        left: testX - 25,
        top: testY - 25,
      }])
      .toBuffer();

    return new NextResponse(finalImage, {
      headers: {
        'Content-Type': 'image/jpeg',
        'Content-Disposition': 'inline; filename="test_position.jpg"',
      },
    });

  } catch (error: any) {
    console.error('Test error:', error);
    return NextResponse.json({ error: 'Test failed' }, { status: 500 });
  }
}

// GET progress endpoint
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

    return NextResponse.json({
      current: progress.current,
      total: progress.total,
      completed: progress.completed,
      successful: progress.successful || 0,
      failed: progress.failed || 0,
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