import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET() {
  try {
    // Load email template
    const emailTemplatePath = path.join(process.cwd(), 'public', 'templates', 'email.eml');

    let emailTemplate = '';
    let subject = 'Your Event Ticket';

    try {
      const templateContent = fs.readFileSync(emailTemplatePath, 'utf-8');

      // Parse subject and message from template
      const lines = templateContent.split('\n');
      let messageStart = 0;

      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('Subject: ')) {
          subject = lines[i].replace('Subject: ', '').trim();
          messageStart = i + 1;
          break;
        }
      }

      // Skip empty lines after subject
      while (messageStart < lines.length && lines[messageStart].trim() === '') {
        messageStart++;
      }

      // Get message content
      emailTemplate = lines.slice(messageStart).join('\n').trim();

    } catch (error) {
      // Fallback template if file doesn't exist
      emailTemplate = `Dear {name},

Thank you for registering for our event. Please find your ticket attached.

Best regards,
Event Team`;
    }

    return NextResponse.json({
      subject,
      message: emailTemplate,
      senderName: process.env.SENDER_NAME || '',
      senderEmail: process.env.SENDER_EMAIL || process.env.EMAIL_USER || '',
      bccList: process.env.SENDER_BCC
        ? process.env.SENDER_BCC.replace(/"/g, '').split(';').filter(email => email.trim())
        : []
    });

  } catch (error) {
    console.error('Failed to load email template:', error);
    return NextResponse.json(
      {
        error: 'Failed to load email template',
        // Fallback values
        subject: 'Your Event Ticket',
        message: `Dear {name},

Thank you for registering for our event. Please find your ticket attached.

Best regards,
Event Team`,
        senderName: process.env.SENDER_NAME || '',
        senderEmail: process.env.SENDER_EMAIL || process.env.EMAIL_USER || '',
        bccList: []
      },
      { status: 500 }
    );
  }
}