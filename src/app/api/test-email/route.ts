import { NextRequest, NextResponse } from 'next/server';
const nodemailer = require('nodemailer');

export async function POST(request: NextRequest) {
  try {
    const { testEmail } = await request.json();

    if (!testEmail) {
      return NextResponse.json(
        { error: 'Test email address is required' },
        { status: 400 }
      );
    }

    // Create nodemailer transporter with custom SMTP server
    const transporter = nodemailer.createTransport({
      host: process.env.EMAIL_SERVER,
      port: 465, // or 465 for SSL
      secure: false, // true for 465, false for other ports
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_APP_PASSWORD,
      },
      tls: {
        rejectUnauthorized: false // Allow self-signed certificates
      }
    });

    // Verify connection configuration
    console.log('Testing email connection...');
    await transporter.verify();
    console.log('Email server connection verified!');

    // Parse BCC list from environment
    const bccList = process.env.SENDER_BCC
      ? process.env.SENDER_BCC.replace(/"/g, '').split(';').filter(email => email.trim())
      : [];

    // Send test email
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: testEmail,
      bcc: bccList.length > 0 ? bccList : undefined,
      subject: 'Test Email from Ticket System',
      text: `This is a test email from your ticket system.

Server: ${process.env.EMAIL_SERVER}
From: ${process.env.EMAIL_USER}
BCC: ${bccList.join(', ') || 'None'}
Sent at: ${new Date().toLocaleString()}

If you receive this email, your email configuration is working correctly!`,
      html: `
        <h2>Test Email from Ticket System</h2>
        <p>This is a test email from your ticket system.</p>
        <ul>
          <li><strong>Server:</strong> ${process.env.EMAIL_SERVER}</li>
          <li><strong>From:</strong> ${process.env.EMAIL_USER}</li>
          <li><strong>BCC:</strong> ${bccList.join(', ') || 'None'}</li>
          <li><strong>Sent at:</strong> ${new Date().toLocaleString()}</li>
        </ul>
        <p>If you receive this email, your email configuration is working correctly!</p>
      `
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('Test email sent:', info.messageId);

    return NextResponse.json({
      success: true,
      message: 'Test email sent successfully',
      messageId: info.messageId,
      config: {
        server: process.env.EMAIL_SERVER,
        user: process.env.EMAIL_USER,
        testEmail,
        bccList: bccList
      }
    });

  } catch (error) {
    console.error('Test email error:', error);

    let errorMessage = 'Unknown error';
    if (error instanceof Error) {
      errorMessage = error.message;
    }

    return NextResponse.json(
      {
        error: 'Failed to send test email',
        details: errorMessage,
        config: {
          server: process.env.EMAIL_SERVER,
          user: process.env.EMAIL_USER,
          hasPassword: !!process.env.EMAIL_APP_PASSWORD
        }
      },
      { status: 500 }
    );
  }
}