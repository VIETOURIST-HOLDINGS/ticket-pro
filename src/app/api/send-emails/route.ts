import { NextRequest, NextResponse } from 'next/server';
const nodemailer = require('nodemailer');
import fs from 'fs';
import path from 'path';
import QRCode from 'qrcode';
import sharp from 'sharp';
import { google } from 'googleapis';

// ⭐⭐ CẤU HÌNH TICKET - ĐIỀU CHỈNH Ở ĐÂY ⭐⭐
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


// --- PHẦN 1: CÁC HÀM CẬP NHẬT GOOGLE SHEETS ---

async function updateGoogleSheetsEmailStatus(
  spreadsheetId: string,
  sheetName: string,
  rowIndices: number[],
  emailSentColumnName: string
) {
  console.log('=== Starting Google Sheets Email Status Update ===');

  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const sheets = google.sheets({ version: 'v4', auth });

  const metadataResponse = await sheets.spreadsheets.get({ spreadsheetId });
  const sheet = metadataResponse.data.sheets?.find(s => s.properties?.title === sheetName);
  if (!sheet) throw new Error(`Sheet "${sheetName}" not found`);

  const headersResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!1:1`,
  });
  const headers = headersResponse.data.values?.[0] as string[];

  let emailSentColumnIndex = headers?.findIndex(h =>
    h?.toLowerCase().includes('email sent') ||
    h?.toLowerCase().includes('email_sent') ||
    h === emailSentColumnName
  );

  if (emailSentColumnIndex === -1) {
    headers?.push(emailSentColumnName);
    emailSentColumnIndex = headers.length - 1;
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!1:1`,
      valueInputOption: 'RAW',
      requestBody: { values: [headers] },
    });
  }

  const getColumnLetter = (index: number): string => {
    let letter = '';
    while (index >= 0) {
      letter = String.fromCharCode(65 + (index % 26)) + letter;
      index = Math.floor(index / 26) - 1;
    }
    return letter;
  };
  const columnLetter = getColumnLetter(emailSentColumnIndex);

  const timestamp = new Date().toLocaleString('vi-VN');
  const updates = rowIndices.map(rowIndex => ({
    range: `${sheetName}!${columnLetter}${rowIndex + 2}`,
    values: [[timestamp]],
  }));

  try {
    const updateResponse = await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: { valueInputOption: 'RAW', data: updates },
    });
    console.log('Google Sheets updated cells:', updateResponse.data.totalUpdatedCells);
  } catch (updateError: any) {
    console.error('Google Sheets update error:', updateError);
  }
}

async function updateGoogleSheetsEmailErrors(
  spreadsheetId: string,
  sheetName: string,
  failedRows: { rowIndex: number; error: string }[],
  emailErrorColumnName: string
) {
  console.log('=== Updating Google Sheets with Email Errors ===');

  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const sheets = google.sheets({ version: 'v4', auth });

  const headersResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!1:1`,
  });
  const headers = headersResponse.data.values?.[0] as string[];

  let emailErrorColumnIndex = headers?.findIndex(h =>
    h?.toLowerCase().includes('email error') ||
    h?.toLowerCase().includes('email_error') ||
    h === emailErrorColumnName
  );

  if (emailErrorColumnIndex === -1) {
    headers?.push(emailErrorColumnName);
    emailErrorColumnIndex = headers.length - 1;
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!1:1`,
      valueInputOption: 'RAW',
      requestBody: { values: [headers] },
    });
  }

  const getColumnLetter = (index: number): string => {
    let letter = '';
    while (index >= 0) {
      letter = String.fromCharCode(65 + (index % 26)) + letter;
      index = Math.floor(index / 26) - 1;
    }
    return letter;
  };

  const columnLetter = getColumnLetter(emailErrorColumnIndex);
  const timestamp = new Date().toLocaleString('vi-VN');
  const updates = failedRows.map(failedRow => ({
    range: `${sheetName}!${columnLetter}${failedRow.rowIndex + 2}`,
    values: [[`${timestamp}: ${failedRow.error.substring(0, 100)}`]],
  }));

  try {
    const updateResponse = await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: { valueInputOption: 'RAW', data: updates },
    });
    console.log('Google Sheets error cells updated:', updateResponse.data.totalUpdatedCells);
  } catch (updateError: any) {
    console.error('Google Sheets error update failed:', updateError);
  }
}

// --- PHẦN 2: HÀM XỬ LÝ TICKET JPG ---

interface EmailData {
  email: string;
  name?: string;
  qrData: string;
  rowNumber: string;
  originalRowIndex?: number;
  rowData: {
    __rowNum__?: number;

    NO?: string;
    NAME?: string;
    EMAIL?: string;
    "NUMBER PHONE"?: string;
    "QR-CODE"?: string;

    TYPE?: string;
    ZONE?: string;

    "Checked In At"?: string;
    checkedInTime?: string | null;

    "Email Sent"?: string;
    "Email Error"?: string;
    "Seat Status"?: string;

    [key: string]: any; // cho phép cột phát sinh thêm
  };
}

// Hàm tạo ticket từ file JPG template với config
async function createTicketFromJPG(
  emailData: EmailData,
  attachTicket: boolean,
  appendTicketInline: boolean
): Promise<{ attachments: any[]; jpgBuffer: Buffer | null }> {
  const attachments: any[] = [];
  let jpgBuffer: Buffer | null = null;

  // Đường dẫn đến file template JPG
  const zone = emailData.rowData?.ZONE?.trim();

  const templateFile =
    (zone && ZONE_TEMPLATE_MAP[zone]) || TICKET_CONFIG.template;

  const templatePath = path.join(process.cwd(), 'public', templateFile);


  // Kiểm tra file template tồn tại
  if (!fs.existsSync(templatePath)) {
    console.error(`❌ Template file not found: ${templatePath}`);
    console.log(`🔍 Looking for: ${TICKET_CONFIG.template} in public folder`);
    return { attachments, jpgBuffer: null };
  }

  console.log(`✅ Using template: ${TICKET_CONFIG.template}`);
  console.log(`📏 QR Size: ${TICKET_CONFIG.qrCode.size}px, Position: (${TICKET_CONFIG.qrCode.position.x}, ${TICKET_CONFIG.qrCode.position.y})`);

  // Đọc template JPG
  const templateBuffer = fs.readFileSync(templatePath);

  // Tạo QR code với config
  const qrBuffer = await QRCode.toBuffer(emailData.qrData, {
    width: TICKET_CONFIG.qrCode.size,
    margin: TICKET_CONFIG.qrCode.margin,
    color: {
      dark: TICKET_CONFIG.qrCode.color.dark,
      light: TICKET_CONFIG.qrCode.color.light
    }
  });

  console.log(`✅ QR Code generated: ${qrBuffer.length} bytes`);

  // Đọc metadata của template để biết kích thước
  const templateMetadata = await sharp(templateBuffer).metadata();
  console.log(`📐 Template dimensions: ${templateMetadata.width} x ${templateMetadata.height}`);

  // Tạo overlay SVG chỉ chứa QR code (không có text nếu bạn không cần)
  const svgOverlay = `
    <svg width="${templateMetadata.width || 10000}" height="${templateMetadata.height || 10000}">
      <!-- Thêm QR code vào vị trí đã cấu hình -->
      <image href="data:image/png;base64,${qrBuffer.toString('base64')}" 
             x="${TICKET_CONFIG.qrCode.position.x}" 
             y="${TICKET_CONFIG.qrCode.position.y}" 
             width="${TICKET_CONFIG.qrCode.size}" 
             height="${TICKET_CONFIG.qrCode.size}"/>
    </svg>
  `;

  // Kết hợp template JPG với QR code
  try {
    jpgBuffer = await sharp(templateBuffer)
      .composite([
        {
          input: Buffer.from(svgOverlay),
          top: 0,
          left: 0
        }
      ])
      .jpeg({ quality: 95 }) // Chất lượng cao
      .toBuffer();

    console.log(`✅ Ticket created successfully: ${jpgBuffer.length} bytes`);

    // Tạo attachment nếu cần
    if ((attachTicket || appendTicketInline) && jpgBuffer) {
      const att: any = {
        filename: `${emailData.rowData.NAME}_${emailData.rowData.ZONE}_${emailData.rowData.NO}.jpg`,
        content: jpgBuffer,
        contentType: 'image/jpeg'
      };

      if (appendTicketInline) {
        att.cid = `${emailData.rowData.NAME}_${emailData.rowData.ZONE}_${emailData.rowData.NO}`;
        att.contentDisposition = 'inline';
      }

      attachments.push(att);
      console.log(`📎 Attachment added for ${emailData.email}`);
    }
  } catch (error: any) {
    console.error(`❌ Error creating ticket:`, error.message);
  }

  return { attachments, jpgBuffer };
}

// --- PHẦN 3: API GỬI EMAIL ---

export async function POST(request: NextRequest) {
  try {
    const {
      emails,
      subject,
      message,
      senderEmail,
      senderName,
      attachTicket,
      appendTicketInline,
      spreadsheetId,
      sheetName,
      emailSentColumnName
    } = await request.json();

    if (!emails || !Array.isArray(emails) || emails.length === 0) {
      return NextResponse.json({ error: 'Emails array is required' }, { status: 400 });
    }

    if (!subject || !message) {
      return NextResponse.json({ error: 'Subject and message are required' }, { status: 400 });
    }

    // --- CẤU HÌNH GMAIL VỚI APP PASSWORD ---
    const GMAIL_USER = process.env.EMAIL_USER || 'hanhtrinhvietnam2025@gmail.com';
    const GMAIL_PASS = (process.env.EMAIL_APP_PASSWORD || '').replace(/\s+/g, '');

    // Kiểm tra credentials
    if (!GMAIL_USER || !GMAIL_PASS) {
      console.error('❌ Missing Gmail credentials in environment variables');
      return NextResponse.json(
        { error: 'Email service configuration error. Please check EMAIL_USER and EMAIL_APP_PASSWORD in .env.local' },
        { status: 500 }
      );
    }

    console.log(`📧 Using Gmail account: ${GMAIL_USER}`);

    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: {
        user: GMAIL_USER,
        pass: GMAIL_PASS,
      },
    });

    // Kiểm tra kết nối SMTP
    try {
      await transporter.verify();
      console.log('✅ SMTP connection verified successfully');
    } catch (verifyError: any) {
      console.error('❌ SMTP connection failed:', verifyError.message);
      return NextResponse.json(
        {
          error: 'Failed to connect to Gmail SMTP server',
          details: verifyError.message,
          tip: 'Check your App Password and ensure 2FA is enabled on your Google account'
        },
        { status: 500 }
      );
    }

    // Load email template
    const emailTemplatePath = path.join(process.cwd(), 'public', 'templates', 'email.eml');
    let emailTemplate = '';
    try {
      const templateContent = fs.readFileSync(emailTemplatePath, 'utf-8');
      const lines = templateContent.split('\n');
      let messageStart = 0;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('Subject: ')) { messageStart = i + 1; break; }
      }
      while (messageStart < lines.length && lines[messageStart].trim() === '') { messageStart++; }
      emailTemplate = lines.slice(messageStart).join('\n').trim();
    } catch (error) {
      emailTemplate = message;
    }

    // Default sender info
    const defaultSenderName = senderName || 'Event Team';
    const defaultSenderEmail = GMAIL_USER;

    // Parse BCC
    const bccList = process.env.SENDER_BCC
      ? process.env.SENDER_BCC.replace(/"/g, '').split(';').filter(email => email.trim())
      : [];

    let successCount = 0;
    let failureCount = 0;
    const errors: string[] = [];
    const successfulEmailRows: number[] = [];
    const failedEmailRows: { rowIndex: number; error: string }[] = [];

    const validateEmail = (email: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    // --- BẮT ĐẦU VÒNG LẶP GỬI MAIL ---
    for (let i = 0; i < emails.length; i++) {
      const emailData = emails[i];

      // Delay để tránh bị Gmail chặn
      if (i > 0) {
        const waitTime = 2000 + Math.random() * 2000;
        console.log(`⏳ Waiting ${Math.round(waitTime / 1000)}s before next email...`);
        await delay(waitTime);
      }

      try {
        console.log(`\n📤 Processing email ${i + 1}/${emails.length}: ${emailData.email}`);

        if (!validateEmail(emailData.email)) {
          throw new Error('Invalid email format');
        }

        let attachments: any[] = [];
        let jpgBuffer: Buffer | null = null;

        // --- XỬ LÝ TICKET JPG ---
        if ((attachTicket || appendTicketInline) && emailData.qrData) {
          console.log(`🎫 Generating ticket with QR: ${emailData.qrData.substring(0, 20)}...`);

          const ticketResult = await createTicketFromJPG(
            emailData,
            attachTicket || false,
            appendTicketInline || false
          );

          attachments = ticketResult.attachments;
          jpgBuffer = ticketResult.jpgBuffer;

          if (!jpgBuffer) {
            console.warn(`⚠️ Could not generate ticket for ${emailData.email}`);
          }
        }

        // --- SOẠN NỘI DUNG EMAIL ---
        const messageToUse = emailTemplate || message;

        const replacePlaceholders = (text: string) => {
          let res = text;
          if (emailData.rowData) {
            Object.keys(emailData.rowData).forEach(k => {
              const value = emailData.rowData![k];
              if (value !== null && value !== undefined) {
                res = res.replace(new RegExp(`\\{${k}\\}`, 'gi'), String(value));
              }
            });
          }
          return res.replace(/\{senderName\}/gi, defaultSenderName)
            .replace(/\{senderEmail\}/gi, defaultSenderEmail)
            .replace(/\{ticketCode\}/gi, emailData.qrData)
            .replace(/\{eventDate\}/gi, new Date().toLocaleDateString('vi-VN'));
        };

        const personalizedMessage = replacePlaceholders(messageToUse);
        const personalizedSubject = replacePlaceholders(subject);

        let htmlContent = personalizedMessage.replace(/\n/g, '<br>');
        if (appendTicketInline && jpgBuffer) {
          htmlContent += `<br><br><img src="cid:ticket-${emailData.rowNumber}" style="width:100%;max-width:800px;display:block;margin:0 auto;">`;
        }

        // --- GỬI MAIL ---
        console.log(`✉️ Sending email to ${emailData.email}...`);
        await transporter.sendMail({
          from: `"${defaultSenderName}" <${defaultSenderEmail}>`,
          to: emailData.email,
          bcc: bccList.length > 0 ? bccList : undefined,
          subject: personalizedSubject,
          text: personalizedMessage,
          html: htmlContent,
          attachments: attachments
        });

        successCount++;
        console.log(`✅ Sent successfully to: ${emailData.email}`);
        if (emailData.originalRowIndex !== undefined) {
          successfulEmailRows.push(emailData.originalRowIndex);
        }

      } catch (emailError: any) {
        failureCount++;
        const errStr = String(emailError.message || emailError);
        console.error(`❌ Error sending to ${emailData.email}:`, errStr);
        errors.push(`${emailData.email}: ${errStr}`);
        if (emailData.originalRowIndex !== undefined) {
          failedEmailRows.push({
            rowIndex: emailData.originalRowIndex,
            error: errStr.substring(0, 200)
          });
        }
      }
    }

    // --- CẬP NHẬT GOOGLE SHEETS ---
    if (spreadsheetId && sheetName) {
      try {
        if (successfulEmailRows.length > 0) {
          console.log(`📊 Updating Google Sheets for ${successfulEmailRows.length} successful emails...`);
          await updateGoogleSheetsEmailStatus(
            spreadsheetId,
            sheetName,
            successfulEmailRows,
            emailSentColumnName || 'Email Sent'
          );
        }
        if (failedEmailRows.length > 0) {
          console.log(`📊 Updating Google Sheets for ${failedEmailRows.length} failed emails...`);
          await updateGoogleSheetsEmailErrors(
            spreadsheetId,
            sheetName,
            failedEmailRows,
            'Email Error'
          );
        }
      } catch (sheetsError: any) {
        console.error('Google Sheets update failed:', sheetsError.message);
      }
    }

    return NextResponse.json({
      success: true,
      message: `Sent ${successCount} emails, ${failureCount} failed`,
      successCount,
      failureCount,
      errors: errors.slice(0, 5)
    });

  } catch (error: any) {
    console.error('API Error:', error);
    return NextResponse.json({
      error: 'Internal Server Error',
      details: String(error.message || error)
    }, { status: 500 });
  }
}