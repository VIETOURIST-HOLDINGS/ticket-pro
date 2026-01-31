import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { cookies } from 'next/headers';

export async function POST(request: NextRequest) {
  try {
    const { spreadsheetId, sheetName = 'Sheet1' } = await request.json();
    console.log('Reading from Google Sheets:', { spreadsheetId, sheetName });

    if (!spreadsheetId) {
      return NextResponse.json(
        { error: 'Spreadsheet ID is required' },
        { status: 400 }
      );
    }

    // Initialize auth (same as connect)
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

    // Read data from sheet
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: sheetName,
    });

    const values = response.data.values || [];

    if (values.length === 0) {
      return NextResponse.json({ headers: [], rows: [] });
    }

    // First row is headers
    const headers = values[0] as string[];

    // Find check-in column index
    const checkInColumnIndex = headers.findIndex((h: string) =>
      h.toLowerCase().includes('check') && h.toLowerCase().includes('in')
    );

    // Convert remaining rows to data
    const rows = [];
    for (let i = 1; i < values.length; i++) {
      const rowData: any = {
        __rowNum__: i + 1,
        checkedInTime: null,
      };

      headers.forEach((header, index) => {
        const cellValue = values[i][index];
        rowData[header] = cellValue || '';

        // Map check-in column to checkedInTime
        if (index === checkInColumnIndex && cellValue) {
          rowData.checkedInTime = cellValue;
        }
      });

      rows.push(rowData);
    }

    return NextResponse.json({ headers, rows });

  } catch (error) {
    console.error('Google Sheets read error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to read Google Sheets data' },
      { status: 500 }
    );
  }
}