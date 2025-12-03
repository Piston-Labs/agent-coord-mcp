import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

// Redis keys for Google Drive integration
const GDRIVE_TOKENS_KEY = 'piston:gdrive:tokens';
const GDRIVE_FILES_KEY = 'piston:gdrive:files';  // Metadata cache

// Google OAuth endpoints
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_DRIVE_API = 'https://www.googleapis.com/drive/v3';
const GOOGLE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';

interface TokenData {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  scope: string;
}

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  webViewLink?: string;
  createdTime?: string;
  modifiedTime?: string;
  size?: string;
}

interface FileMetadata {
  driveId: string;
  name: string;
  type: string;
  folder: string;
  webViewLink: string;
  uploadedBy: string;
  uploadedAt: string;
  localFileId?: string;  // Link to sales-files if applicable
}

/**
 * Google Drive API - Integration for Piston Labs sales documents
 *
 * GET /api/google-drive?action=auth-url - Get OAuth authorization URL
 * GET /api/google-drive?action=callback&code=X - Handle OAuth callback
 * GET /api/google-drive?action=list - List files in folder
 * GET /api/google-drive?action=get&fileId=X - Get file metadata
 * POST /api/google-drive?action=upload - Upload file to Drive
 * POST /api/google-drive?action=create-folder - Create folder
 * DELETE /api/google-drive?action=delete&fileId=X - Delete file
 * GET /api/google-drive?action=status - Check connection status
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { action } = req.query;

  // Check required env vars
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_DRIVE_REDIRECT_URI || `${process.env.VERCEL_URL || 'http://localhost:3000'}/api/google-drive?action=callback`;

  if (!clientId || !clientSecret) {
    return res.status(500).json({
      error: 'Google Drive not configured',
      setup: {
        required: ['GOOGLE_DRIVE_CLIENT_ID', 'GOOGLE_DRIVE_CLIENT_SECRET'],
        optional: ['GOOGLE_DRIVE_REDIRECT_URI', 'GOOGLE_DRIVE_FOLDER_ID'],
        instructions: 'Create credentials at https://console.cloud.google.com/apis/credentials'
      }
    });
  }

  try {
    // =========================================================================
    // AUTH: Get authorization URL
    // =========================================================================
    if (action === 'auth-url') {
      const scopes = [
        'https://www.googleapis.com/auth/drive.file',  // Create/manage files created by app
        'https://www.googleapis.com/auth/drive.metadata.readonly'  // Read metadata
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
        instructions: 'Open this URL in a browser to authorize Google Drive access'
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

      await redis.set(GDRIVE_TOKENS_KEY, JSON.stringify(tokens));

      // Return success page or JSON
      if (req.headers.accept?.includes('text/html')) {
        return res.send(`
          <html>
            <body style="font-family: sans-serif; padding: 40px; text-align: center;">
              <h1>Google Drive Connected!</h1>
              <p>You can close this window and return to your agent.</p>
            </body>
          </html>
        `);
      }

      return res.json({
        success: true,
        message: 'Google Drive connected successfully',
        expiresAt: new Date(tokens.expires_at).toISOString()
      });
    }

    // =========================================================================
    // STATUS: Check connection status
    // =========================================================================
    if (action === 'status') {
      const tokensJson = await redis.get(GDRIVE_TOKENS_KEY);

      if (!tokensJson) {
        return res.json({
          connected: false,
          message: 'Not connected. Use action=auth-url to get authorization URL.'
        });
      }

      const tokens: TokenData = typeof tokensJson === 'string' ? JSON.parse(tokensJson) : tokensJson;
      const isExpired = Date.now() > tokens.expires_at;

      return res.json({
        connected: true,
        expired: isExpired,
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
    // LIST: List files in folder
    // =========================================================================
    if (action === 'list' && req.method === 'GET') {
      const { folderId, query, pageSize = '50' } = req.query;

      const targetFolder = folderId || process.env.GOOGLE_DRIVE_FOLDER_ID || 'root';

      let q = `'${targetFolder}' in parents and trashed = false`;
      if (query) {
        q += ` and name contains '${query}'`;
      }

      const params = new URLSearchParams({
        q,
        pageSize: pageSize as string,
        fields: 'files(id,name,mimeType,parents,webViewLink,createdTime,modifiedTime,size)',
        orderBy: 'modifiedTime desc'
      });

      const listRes = await fetch(`${GOOGLE_DRIVE_API}/files?${params}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });

      const data = await listRes.json();

      if (data.error) {
        return res.status(data.error.code || 500).json({ error: data.error.message });
      }

      return res.json({
        files: data.files || [],
        count: data.files?.length || 0,
        folder: targetFolder
      });
    }

    // =========================================================================
    // GET: Get file metadata
    // =========================================================================
    if (action === 'get' && req.method === 'GET') {
      const { fileId } = req.query;

      if (!fileId) {
        return res.status(400).json({ error: 'fileId required' });
      }

      const params = new URLSearchParams({
        fields: 'id,name,mimeType,parents,webViewLink,createdTime,modifiedTime,size,description'
      });

      const fileRes = await fetch(`${GOOGLE_DRIVE_API}/files/${fileId}?${params}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });

      const data = await fileRes.json();

      if (data.error) {
        return res.status(data.error.code || 500).json({ error: data.error.message });
      }

      return res.json({ file: data });
    }

    // =========================================================================
    // UPLOAD: Upload file to Google Drive
    // =========================================================================
    if (action === 'upload' && req.method === 'POST') {
      const { name, content, mimeType, folderId, description, localFileId, uploadedBy } = req.body;

      if (!name || !content) {
        return res.status(400).json({ error: 'name and content required' });
      }

      const targetFolder = folderId || process.env.GOOGLE_DRIVE_FOLDER_ID;

      // Determine MIME type
      const fileMimeType = mimeType || getMimeType(name);

      // Create metadata
      const metadata: any = {
        name,
        mimeType: fileMimeType
      };

      if (targetFolder) {
        metadata.parents = [targetFolder];
      }

      if (description) {
        metadata.description = description;
      }

      // Use multipart upload for text content
      const boundary = '-------314159265358979323846';
      const delimiter = `\r\n--${boundary}\r\n`;
      const closeDelim = `\r\n--${boundary}--`;

      const multipartBody =
        delimiter +
        'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
        JSON.stringify(metadata) +
        delimiter +
        `Content-Type: ${fileMimeType}\r\n\r\n` +
        content +
        closeDelim;

      const uploadRes = await fetch(`${GOOGLE_UPLOAD_API}/files?uploadType=multipart&fields=id,name,webViewLink,mimeType`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': `multipart/related; boundary=${boundary}`
        },
        body: multipartBody
      });

      const data = await uploadRes.json();

      if (data.error) {
        return res.status(data.error.code || 500).json({ error: data.error.message });
      }

      // Cache metadata in Redis
      const fileMetadata: FileMetadata = {
        driveId: data.id,
        name: data.name,
        type: fileMimeType,
        folder: targetFolder || 'root',
        webViewLink: data.webViewLink,
        uploadedBy: uploadedBy || 'unknown',
        uploadedAt: new Date().toISOString(),
        localFileId
      };

      await redis.hset(GDRIVE_FILES_KEY, { [data.id]: JSON.stringify(fileMetadata) });

      return res.json({
        success: true,
        file: data,
        message: `File "${name}" uploaded to Google Drive`
      });
    }

    // =========================================================================
    // CREATE-FOLDER: Create a folder in Google Drive
    // =========================================================================
    if (action === 'create-folder' && req.method === 'POST') {
      const { name, parentId } = req.body;

      if (!name) {
        return res.status(400).json({ error: 'Folder name required' });
      }

      const targetParent = parentId || process.env.GOOGLE_DRIVE_FOLDER_ID;

      const metadata: any = {
        name,
        mimeType: 'application/vnd.google-apps.folder'
      };

      if (targetParent) {
        metadata.parents = [targetParent];
      }

      const createRes = await fetch(`${GOOGLE_DRIVE_API}/files?fields=id,name,webViewLink`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(metadata)
      });

      const data = await createRes.json();

      if (data.error) {
        return res.status(data.error.code || 500).json({ error: data.error.message });
      }

      return res.json({
        success: true,
        folder: data,
        message: `Folder "${name}" created`
      });
    }

    // =========================================================================
    // DELETE: Delete file from Google Drive
    // =========================================================================
    if (action === 'delete' && req.method === 'DELETE') {
      const { fileId } = req.query;

      if (!fileId) {
        return res.status(400).json({ error: 'fileId required' });
      }

      const deleteRes = await fetch(`${GOOGLE_DRIVE_API}/files/${fileId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` }
      });

      if (!deleteRes.ok && deleteRes.status !== 204) {
        const data = await deleteRes.json();
        return res.status(data.error?.code || 500).json({ error: data.error?.message || 'Delete failed' });
      }

      // Remove from Redis cache
      await redis.hdel(GDRIVE_FILES_KEY, fileId as string);

      return res.json({
        success: true,
        deleted: fileId,
        message: 'File deleted from Google Drive'
      });
    }

    // =========================================================================
    // SEARCH: Search files across Drive
    // =========================================================================
    if (action === 'search' && req.method === 'GET') {
      const { query, pageSize = '20' } = req.query;

      if (!query) {
        return res.status(400).json({ error: 'query required' });
      }

      const params = new URLSearchParams({
        q: `name contains '${query}' and trashed = false`,
        pageSize: pageSize as string,
        fields: 'files(id,name,mimeType,webViewLink,modifiedTime)',
        orderBy: 'modifiedTime desc'
      });

      const searchRes = await fetch(`${GOOGLE_DRIVE_API}/files?${params}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });

      const data = await searchRes.json();

      if (data.error) {
        return res.status(data.error.code || 500).json({ error: data.error.message });
      }

      return res.json({
        files: data.files || [],
        count: data.files?.length || 0,
        query
      });
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });

  } catch (error) {
    console.error('Google Drive API error:', error);
    return res.status(500).json({ error: 'Server error', details: String(error) });
  }
}

/**
 * Get a valid access token, refreshing if necessary
 */
async function getValidAccessToken(clientId: string, clientSecret: string): Promise<string | null> {
  const tokensJson = await redis.get(GDRIVE_TOKENS_KEY);

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
      // Clear invalid tokens
      await redis.del(GDRIVE_TOKENS_KEY);
      return null;
    }

    // Update tokens
    tokens = {
      access_token: refreshData.access_token,
      refresh_token: tokens.refresh_token,  // Keep original refresh token
      expires_at: Date.now() + (refreshData.expires_in * 1000),
      scope: refreshData.scope || tokens.scope
    };

    await redis.set(GDRIVE_TOKENS_KEY, JSON.stringify(tokens));
  }

  return tokens.access_token;
}

/**
 * Determine MIME type from filename
 */
function getMimeType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();

  const mimeTypes: Record<string, string> = {
    'md': 'text/markdown',
    'txt': 'text/plain',
    'html': 'text/html',
    'json': 'application/json',
    'pdf': 'application/pdf',
    'doc': 'application/msword',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'xls': 'application/vnd.ms-excel',
    'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'ppt': 'application/vnd.ms-powerpoint',
    'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'csv': 'text/csv',
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'svg': 'image/svg+xml'
  };

  return mimeTypes[ext || ''] || 'text/plain';
}
