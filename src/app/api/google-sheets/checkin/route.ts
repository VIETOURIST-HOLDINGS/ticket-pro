import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { cookies } from 'next/headers';

export async function POST(request: NextRequest) {
  try {
    const { spreadsheetId, sheetName = 'Sheet1', rowNumber, checkInTime } = await request.json();

    console.log('Check-in request:', { spreadsheetId, sheetName, rowNumber, checkInTime });

    if (!spreadsheetId || !rowNumber) {
      return NextResponse.json(
        { error: 'Spreadsheet ID and row number are required' },
        { status: 400 }
      );
    }

    // Initialize auth
    let auth;

    if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
      auth = new google.auth.GoogleAuth({
        credentials: {
          client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
          private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        },
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });
    } else if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
      // Try refresh token from env first
      let refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

      // If not in env, try cookies
      if (!refreshToken) {
        const cookieStore = cookies();
        refreshToken = cookieStore.get('google_refresh_token')?.value;
      }

      if (refreshToken) {
        const oauth2Client = new google.auth.OAuth2(
          process.env.GOOGLE_CLIENT_ID,
          process.env.GOOGLE_CLIENT_SECRET
        );

        oauth2Client.setCredentials({
          refresh_token: refreshToken,
        });

        auth = oauth2Client;
      } else {
        return NextResponse.json(
          { error: 'Not authenticated. Please authorize first.' },
          { status: 401 }
        );
      }
    } else {
      return NextResponse.json(
        { error: 'Google API credentials not configured' },
        { status: 500 }
      );
    }

    const sheets = google.sheets({ version: 'v4', auth });

    // Get headers to find check-in column
    const headerResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!1:1`,
    });

    const headers = headerResponse.data.values?.[0] || [];
    console.log('Headers found:', headers);

    let checkInColumnIndex = headers.findIndex((h: string) =>
      h.toLowerCase().includes('check') && h.toLowerCase().includes('in')
    );

    console.log('Check-in column index:', checkInColumnIndex);

    // Helper function to convert column index to letter(s) (0=A, 25=Z, 26=AA, etc.)
    const getColumnLetter = (index: number): string => {
      let letter = '';
      while (index >= 0) {
        letter = String.fromCharCode(65 + (index % 26)) + letter;
        index = Math.floor(index / 26) - 1;
      }
      return letter;
    };

    // If no check-in column exists, add one
    if (checkInColumnIndex === -1) {
      checkInColumnIndex = headers.length;
      const columnLetter = getColumnLetter(checkInColumnIndex);

      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${sheetName}!${columnLetter}1`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [['Checked-In At']],
        },
      });
    }

    // Update the specific cell with check-in time
    const columnLetter = getColumnLetter(checkInColumnIndex);
    const cellRange = `${sheetName}!${columnLetter}${rowNumber}`;

    const checkInDateTime = new Date(checkInTime).toLocaleString('vi-VN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: cellRange,
      valueInputOption: 'RAW',
      requestBody: {
        values: [[checkInDateTime]],
      },
    });

    console.log(`✅ Check-in saved: ${cellRange} = ${checkInDateTime}`);

    return NextResponse.json({
      success: true,
      message: `Check-in saved for row ${rowNumber}`,
      details: {
        cell: cellRange,
        value: checkInDateTime
      }
    });

  } catch (error: any) {
    console.error('Google Sheets check-in error:', error);

    // More detailed error logging
    if (error.response) {
      console.error('Error response:', {
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data
      });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save check-in' },
      { status: 500 }
    );
  }
}