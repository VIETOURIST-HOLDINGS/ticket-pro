import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { cookies } from 'next/headers';

export async function POST(request: NextRequest) {
  try {
    const { spreadsheetId, sheetName } = await request.json();

    if (!spreadsheetId) {
      return NextResponse.json(
        { error: 'Spreadsheet ID is required' },
        { status: 400 }
      );
    }

    // Initialize auth
    let auth;

    // Try service account first
    if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
      auth = new google.auth.GoogleAuth({
        credentials: {
          client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
          private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        },
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });
    }
    // Try OAuth with refresh token from env
    else if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN) {
      const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET
      );

      oauth2Client.setCredentials({
        refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
      });

      auth = oauth2Client;
    }

    // Try OAuth with cookies
    else if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
      const cookieStore = cookies();
      const refreshToken = cookieStore.get('google_refresh_token')?.value;

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
          { error: 'Not authenticated. Please click "Authorize with Google" button.' },
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

    // Test connection by getting spreadsheet info
    const response = await sheets.spreadsheets.get({
      spreadsheetId,
    });

    return NextResponse.json({
      success: true,
      spreadsheetTitle: response.data.properties?.title,
      sheetNames: response.data.sheets?.map((sheet: any) => sheet.properties?.title),
    });

  } catch (error: any) {
    console.error('Google Sheets connection error:', error);

    // More detailed error for debugging
    if (error.response) {
      console.error('Error response:', {
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data
      });
    }

    // Common error messages
    let errorMessage = 'Failed to connect to Google Sheets';
    if (error.message?.includes('unauthorized_client')) {
      errorMessage = 'OAuth configuration error. Please check your credentials or use Service Account instead.';
    } else if (error.message?.includes('invalid_grant')) {
      errorMessage = 'Refresh token expired. Please get a new refresh token or use Service Account.';
    } else if (error.message?.includes('Google Sheets API has not been used')) {
      // Extract the enable URL from the error message
      const enableUrlMatch = error.message.match(/https:\/\/console\.developers\.google\.com\/apis\/api\/sheets\.googleapis\.com\/overview\?project=\d+/);
      const enableUrl = enableUrlMatch ? enableUrlMatch[0] : 'https://console.cloud.google.com/apis/library/sheets.googleapis.com';
      errorMessage = `ENABLE_API_REQUIRED:${enableUrl}`;
    } else if (error.message?.includes('This operation is not supported for this document')) {
      errorMessage = 'INVALID_DOCUMENT:This is not a Google Sheets document. Please make sure you are using a Google Sheets URL, not Google Docs, Excel Online, or other document types.';
    } else if (error.message?.includes('Requested entity was not found')) {
      errorMessage = 'SHEET_NOT_FOUND:The spreadsheet was not found. Please check the URL and make sure the sheet exists.';
    }

    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}