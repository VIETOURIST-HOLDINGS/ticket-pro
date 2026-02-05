// /api/generate-ticket/route.ts
import { NextRequest, NextResponse } from 'next/server';
import QRCode from 'qrcode';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

// ⭐⭐ ĐIỀU CHỈNH Ở ĐÂY ⭐⭐
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




export async function POST(request: NextRequest) {
  try {
    const {
      qrData,
      rowData,
      format = 'jpg',
      preview = false,
      quality = 90,
      download = false,
      // ⭐ Có thể override từ client
      qrSize = TICKET_CONFIG.qrCode.size,
      qrPositionX = TICKET_CONFIG.qrCode.position.x,
      qrPositionY = TICKET_CONFIG.qrCode.position.y
    } = await request.json();
    const zone = rowData?.ZONE?.trim();
    if (!qrData) {
      return NextResponse.json(
        { error: 'QR data is required' },
        { status: 400 }
      );
    }

    // Đường dẫn template
    const templateFile =
      (zone && ZONE_TEMPLATE_MAP[zone]) || TICKET_CONFIG.template;

    const templatePath = path.join(process.cwd(), 'public', templateFile);


    if (!fs.existsSync(templatePath)) {
      return NextResponse.json(
        {
          error: `Template file not found: ${TICKET_CONFIG.template}`,
          suggestion: 'Place your template in /public/ticket-template.jpg'
        },
        { status: 404 }
      );
    }

    // ⭐ Tạo QR code với kích thước được chỉ định
    const qrBuffer = await QRCode.toBuffer(qrData, {
      width: qrSize,
      margin: TICKET_CONFIG.qrCode.margin,
      color: TICKET_CONFIG.qrCode.color
    });

    // Xử lý image
    const image = sharp(templatePath);

    // ⭐ Thêm QR code ở vị trí được chỉ định
    const composites: sharp.OverlayOptions[] = [
      {
        input: qrBuffer,
        left: qrPositionX,
        top: qrPositionY,
      }
    ];

    const finalImage = await image
      .composite(composites)
      .jpeg({
        quality: preview ? 70 : Math.min(Math.max(quality, 1), 100),
        mozjpeg: true
      })
      .toBuffer();


    // Trả về image
    const timestamp = Date.now();
    const filename = download
      ? `ve-concert-${timestamp}.jpg`
      : `preview-${timestamp}.jpg`;

    return new NextResponse(finalImage, {
      headers: {
        'Content-Type': 'image/jpeg',
        'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${filename}"`,
      },
    });

  } catch (error: any) {
    console.error('Generate ticket error:', error);
    return NextResponse.json(
      { error: 'Failed to generate ticket' },
      { status: 500 }
    );
  }
}