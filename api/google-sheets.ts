import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

// Reuse Google Drive tokens (will need re-auth with expanded scope)
const GDRIVE_TOKENS_KEY = 'piston:gdrive:tokens';
const GSHEETS_TOKENS_KEY = 'piston:gsheets:tokens';

// Google OAuth endpoints
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';

interface TokenData {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  scope: string;
}

/**
 * Google Sheets API - Read and write spreadsheet data
 *
 * GET /api/google-sheets?action=auth-url - Get OAuth authorization URL (with Sheets scope)
 * GET /api/google-sheets?action=status - Check connection status
 * GET /api/google-sheets?action=read&spreadsheetId=X&range=A1:Z100 - Read data
 * POST /api/google-sheets?action=append - Append row to sheet
 * POST /api/google-sheets?action=update - Update specific cells
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { action } = req.query;

  // Check required env vars
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_SHEETS_REDIRECT_URI ||
    'https://agent-coord-mcp.vercel.app/api/google-sheets?action=callback';

  if (!clientId || !clientSecret) {
    return res.status(500).json({
      error: 'Google API not configured',
      setup: {
        required: ['GOOGLE_DRIVE_CLIENT_ID', 'GOOGLE_DRIVE_CLIENT_SECRET'],
        instructions: 'Create credentials at https://console.cloud.google.com/apis/credentials'
      }
    });
  }

  try {
    // =========================================================================
    // AUTH: Get authorization URL with Sheets scope
    // =========================================================================
    if (action === 'auth-url') {
      const scopes = [
        'https://www.googleapis.com/auth/spreadsheets',  // Full Sheets access
        'https://www.googleapis.com/auth/drive.file',    // Drive file access
        'https://www.googleapis.com/auth/drive.metadata.readonly'
      ].join(' ');

      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
        `client_id=${clientId}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&response_type=code` +
        `&scope=${encodeURIComponent(scopes)}` +
        `&access_type=offline` +
        `&prompt=consent`;

      return res.json({
        authUrl,
        instructions: 'Open this URL in a browser to authorize Google Sheets access'
      });
    }

    // =========================================================================
    // AUTH: Handle OAuth callback
    // =========================================================================
    if (action === 'callback') {
      const { code, error } = req.query;

      if (error) {
        return res.status(400).json({ error: `OAuth error: ${error}` });
      }

      if (!code) {
        return res.status(400).json({ error: 'Authorization code required' });
      }

      // Exchange code for tokens
      const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code: code as string,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri
        })
      });

      const tokenData = await tokenRes.json();

      if (tokenData.error) {
        return res.status(400).json({ error: tokenData.error_description || tokenData.error });
      }

      // Store tokens in Redis
      const tokens: TokenData = {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_at: Date.now() + (tokenData.expires_in * 1000),
        scope: tokenData.scope
      };

      // Store under Sheets key AND update Drive key (since scope is superset)
      await redis.set(GSHEETS_TOKENS_KEY, JSON.stringify(tokens));
      await redis.set(GDRIVE_TOKENS_KEY, JSON.stringify(tokens));

      // Return success page
      if (req.headers.accept?.includes('text/html')) {
        return res.send(`
          <html>
            <body style="font-family: sans-serif; padding: 40px; text-align: center;">
              <h1>Google Sheets Connected!</h1>
              <p>You can close this window and return to your agent.</p>
              <p style="color: green;">✓ Sheets access granted</p>
              <p style="color: green;">✓ Drive access granted</p>
            </body>
          </html>
        `);
      }

      return res.json({
        success: true,
        message: 'Google Sheets connected successfully',
        expiresAt: new Date(tokens.expires_at).toISOString()
      });
    }

    // =========================================================================
    // STATUS: Check connection status
    // =========================================================================
    if (action === 'status') {
      const tokensJson = await redis.get(GSHEETS_TOKENS_KEY);

      if (!tokensJson) {
        return res.json({
          connected: false,
          message: 'Not connected. Use action=auth-url to get authorization URL.'
        });
      }

      const tokens: TokenData = typeof tokensJson === 'string' ? JSON.parse(tokensJson) : tokensJson;
      const isExpired = Date.now() > tokens.expires_at;
      const hasSheetScope = tokens.scope?.includes('spreadsheets');

      return res.json({
        connected: true,
        expired: isExpired,
        hasSheetScope,
        expiresAt: new Date(tokens.expires_at).toISOString(),
        message: isExpired ? 'Token expired, will refresh on next request' : 'Connected and ready'
      });
    }

    // For all other actions, we need a valid access token
    const accessToken = await getValidAccessToken(clientId, clientSecret);

    if (!accessToken) {
      return res.status(401).json({
        error: 'Not authenticated',
        action: 'auth-url',
        message: 'Call with action=auth-url to get authorization URL'
      });
    }

    // =========================================================================
    // READ: Read data from spreadsheet
    // =========================================================================
    if (action === 'read' && req.method === 'GET') {
      const { spreadsheetId, range } = req.query;

      if (!spreadsheetId) {
        return res.status(400).json({ error: 'spreadsheetId required' });
      }

      const readRange = range || 'Sheet1';
      const url = `${GOOGLE_SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(readRange as string)}`;

      const readRes = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });

      const data = await readRes.json();

      if (data.error) {
        return res.status(data.error.code || 500).json({ error: data.error.message });
      }

      return res.json({
        spreadsheetId,
        range: data.range,
        values: data.values || [],
        rowCount: data.values?.length || 0
      });
    }

    // =========================================================================
    // APPEND: Append row(s) to spreadsheet
    // =========================================================================
    if (action === 'append' && req.method === 'POST') {
      const { spreadsheetId, range, values } = req.body;

      if (!spreadsheetId || !values) {
        return res.status(400).json({ error: 'spreadsheetId and values required' });
      }

      const appendRange = range || 'Sheet1';
      const url = `${GOOGLE_SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(appendRange)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

      // values should be array of arrays, e.g., [["col1", "col2", "col3"]]
      const requestBody = {
        values: Array.isArray(values[0]) ? values : [values]
      };

      const appendRes = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      const data = await appendRes.json();

      if (data.error) {
        return res.status(data.error.code || 500).json({ error: data.error.message });
      }

      return res.json({
        success: true,
        spreadsheetId,
        updatedRange: data.updates?.updatedRange,
        updatedRows: data.updates?.updatedRows,
        updatedCells: data.updates?.updatedCells,
        message: `Appended ${data.updates?.updatedRows || 0} row(s)`
      });
    }

    // =========================================================================
    // UPDATE: Update specific cells
    // =========================================================================
    if (action === 'update' && req.method === 'POST') {
      const { spreadsheetId, range, values } = req.body;

      if (!spreadsheetId || !range || !values) {
        return res.status(400).json({ error: 'spreadsheetId, range, and values required' });
      }

      const url = `${GOOGLE_SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;

      const requestBody = {
        values: Array.isArray(values[0]) ? values : [values]
      };

      const updateRes = await fetch(url, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      const data = await updateRes.json();

      if (data.error) {
        return res.status(data.error.code || 500).json({ error: data.error.message });
      }

      return res.json({
        success: true,
        spreadsheetId,
        updatedRange: data.updatedRange,
        updatedRows: data.updatedRows,
        updatedCells: data.updatedCells
      });
    }

    // =========================================================================
    // GET-METADATA: Get spreadsheet metadata
    // =========================================================================
    if (action === 'metadata' && req.method === 'GET') {
      const { spreadsheetId } = req.query;

      if (!spreadsheetId) {
        return res.status(400).json({ error: 'spreadsheetId required' });
      }

      const url = `${GOOGLE_SHEETS_API}/${spreadsheetId}?fields=spreadsheetId,properties,sheets.properties`;

      const metaRes = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });

      const data = await metaRes.json();

      if (data.error) {
        return res.status(data.error.code || 500).json({ error: data.error.message });
      }

      return res.json({
        spreadsheetId: data.spreadsheetId,
        title: data.properties?.title,
        sheets: data.sheets?.map((s: any) => ({
          sheetId: s.properties?.sheetId,
          title: s.properties?.title,
          index: s.properties?.index,
          rowCount: s.properties?.gridProperties?.rowCount,
          columnCount: s.properties?.gridProperties?.columnCount
        }))
      });
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });

  } catch (error) {
    console.error('Google Sheets API error:', error);
    return res.status(500).json({ error: 'Server error', details: String(error) });
  }
}

/**
 * Get a valid access token, refreshing if necessary
 */
async function getValidAccessToken(clientId: string, clientSecret: string): Promise<string | null> {
  // Try Sheets tokens first, fall back to Drive tokens
  let tokensJson = await redis.get(GSHEETS_TOKENS_KEY);

  if (!tokensJson) {
    tokensJson = await redis.get(GDRIVE_TOKENS_KEY);
  }

  if (!tokensJson) {
    return null;
  }

  let tokens: TokenData = typeof tokensJson === 'string' ? JSON.parse(tokensJson) : tokensJson;

  // Check if token needs refresh (with 5 minute buffer)
  if (Date.now() > tokens.expires_at - 300000) {
    // Refresh the token
    const refreshRes = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: tokens.refresh_token,
        grant_type: 'refresh_token'
      })
    });

    const refreshData = await refreshRes.json();

    if (refreshData.error) {
      console.error('Token refresh failed:', refreshData);
      return null;
    }

    // Update tokens
    tokens = {
      access_token: refreshData.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: Date.now() + (refreshData.expires_in * 1000),
      scope: refreshData.scope || tokens.scope
    };

    await redis.set(GSHEETS_TOKENS_KEY, JSON.stringify(tokens));
  }

  return tokens.access_token;
}
# Google Sheets API added
