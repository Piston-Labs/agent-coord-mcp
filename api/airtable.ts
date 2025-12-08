import type { VercelRequest, VercelResponse } from '@vercel/node';

const AIRTABLE_API_URL = 'https://api.airtable.com/v0';
const AIRTABLE_TOKEN = process.env.AIRTABLE_API_TOKEN;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;

/**
 * Airtable Integration API
 *
 * Enables agents to manage features, tasks, and product roadmap in Airtable.
 *
 * Required env vars:
 * - AIRTABLE_API_TOKEN: Personal Access Token from https://airtable.com/create/tokens
 * - AIRTABLE_BASE_ID: Base ID (starts with "app...")
 *
 * Actions:
 * - list-records: Get records from a table
 * - get-record: Get a specific record by ID
 * - create-record: Create a new record
 * - update-record: Update an existing record
 * - delete-record: Delete a record
 * - list-tables: List all tables in the base (requires metadata scope)
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (!AIRTABLE_TOKEN) {
    return res.status(500).json({
      error: 'AIRTABLE_API_TOKEN not configured',
      setup: 'Create a Personal Access Token at https://airtable.com/create/tokens with data.records:read and data.records:write scopes'
    });
  }

  if (!AIRTABLE_BASE_ID) {
    return res.status(500).json({
      error: 'AIRTABLE_BASE_ID not configured',
      setup: 'Find your Base ID in Airtable URL: airtable.com/appXXXXXXXXXXXXXX/...'
    });
  }

  try {
    const { action, table, recordId } = req.query;
    let body: any = {};

    if (req.method === 'POST' || req.method === 'PATCH') {
      try {
        body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      } catch (e) {
        return res.status(400).json({ error: 'Invalid JSON body' });
      }
    }

    const headers = {
      'Authorization': `Bearer ${AIRTABLE_TOKEN}`,
      'Content-Type': 'application/json',
    };

    // List records from a table
    if (action === 'list-records') {
      if (!table) {
        return res.status(400).json({ error: 'table parameter required' });
      }

      const { view, maxRecords, filterByFormula, sort, fields } = req.query;
      const params = new URLSearchParams();

      if (view) params.append('view', view as string);
      if (maxRecords) params.append('maxRecords', maxRecords as string);
      if (filterByFormula) params.append('filterByFormula', filterByFormula as string);
      if (fields) {
        const fieldList = (fields as string).split(',');
        fieldList.forEach(f => params.append('fields[]', f.trim()));
      }
      if (sort) {
        // sort format: "field:direction,field2:direction"
        const sortParts = (sort as string).split(',');
        sortParts.forEach((s, i) => {
          const [field, direction] = s.split(':');
          params.append(`sort[${i}][field]`, field);
          if (direction) params.append(`sort[${i}][direction]`, direction);
        });
      }

      const url = `${AIRTABLE_API_URL}/${AIRTABLE_BASE_ID}/${encodeURIComponent(table as string)}?${params}`;
      const response = await fetch(url, { headers });
      const data = await response.json();

      if (!response.ok) {
        return res.status(response.status).json({ error: 'Airtable API error', details: data });
      }

      return res.json({
        success: true,
        table,
        records: data.records,
        offset: data.offset, // for pagination
      });
    }

    // Get a specific record
    if (action === 'get-record') {
      if (!table || !recordId) {
        return res.status(400).json({ error: 'table and recordId parameters required' });
      }

      const url = `${AIRTABLE_API_URL}/${AIRTABLE_BASE_ID}/${encodeURIComponent(table as string)}/${recordId}`;
      const response = await fetch(url, { headers });
      const data = await response.json();

      if (!response.ok) {
        return res.status(response.status).json({ error: 'Airtable API error', details: data });
      }

      return res.json({
        success: true,
        record: data,
      });
    }

    // Create record(s)
    if (action === 'create-record') {
      if (!table) {
        return res.status(400).json({ error: 'table parameter required' });
      }

      const { fields, records } = body;

      // Support single record (fields) or multiple (records array)
      let payload: any;
      if (records && Array.isArray(records)) {
        // Batch create (max 10 per request)
        payload = {
          records: records.slice(0, 10).map((r: any) => ({ fields: r.fields || r })),
        };
      } else if (fields) {
        payload = {
          records: [{ fields }],
        };
      } else {
        return res.status(400).json({
          error: 'fields or records required in body',
          example: { fields: { Name: 'Feature name', Status: 'Planned' } }
        });
      }

      const url = `${AIRTABLE_API_URL}/${AIRTABLE_BASE_ID}/${encodeURIComponent(table as string)}`;
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });
      const data = await response.json();

      if (!response.ok) {
        return res.status(response.status).json({ error: 'Airtable API error', details: data });
      }

      return res.json({
        success: true,
        created: data.records,
      });
    }

    // Update record(s)
    if (action === 'update-record') {
      if (!table) {
        return res.status(400).json({ error: 'table parameter required' });
      }

      const { fields, records } = body;
      const id = recordId || body.id;

      let payload: any;
      if (records && Array.isArray(records)) {
        // Batch update
        payload = {
          records: records.slice(0, 10).map((r: any) => ({
            id: r.id,
            fields: r.fields,
          })),
        };
      } else if (id && fields) {
        payload = {
          records: [{ id, fields }],
        };
      } else {
        return res.status(400).json({
          error: 'recordId + fields or records array required',
          example: { id: 'recXXX', fields: { Status: 'In Progress' } }
        });
      }

      const url = `${AIRTABLE_API_URL}/${AIRTABLE_BASE_ID}/${encodeURIComponent(table as string)}`;
      const response = await fetch(url, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(payload),
      });
      const data = await response.json();

      if (!response.ok) {
        return res.status(response.status).json({ error: 'Airtable API error', details: data });
      }

      return res.json({
        success: true,
        updated: data.records,
      });
    }

    // Delete record(s)
    if (action === 'delete-record') {
      if (!table) {
        return res.status(400).json({ error: 'table parameter required' });
      }

      const ids = recordId
        ? [recordId as string]
        : (body.ids || body.records?.map((r: any) => r.id) || []);

      if (ids.length === 0) {
        return res.status(400).json({ error: 'recordId or ids array required' });
      }

      const params = new URLSearchParams();
      ids.slice(0, 10).forEach((id: string) => params.append('records[]', id));

      const url = `${AIRTABLE_API_URL}/${AIRTABLE_BASE_ID}/${encodeURIComponent(table as string)}?${params}`;
      const response = await fetch(url, {
        method: 'DELETE',
        headers,
      });
      const data = await response.json();

      if (!response.ok) {
        return res.status(response.status).json({ error: 'Airtable API error', details: data });
      }

      return res.json({
        success: true,
        deleted: data.records,
      });
    }

    // List tables in base (requires schema.bases:read scope)
    if (action === 'list-tables') {
      const url = `https://api.airtable.com/v0/meta/bases/${AIRTABLE_BASE_ID}/tables`;
      const response = await fetch(url, { headers });
      const data = await response.json();

      if (!response.ok) {
        return res.status(response.status).json({
          error: 'Airtable API error',
          details: data,
          hint: 'Ensure your token has schema.bases:read scope'
        });
      }

      return res.json({
        success: true,
        tables: data.tables?.map((t: any) => ({
          id: t.id,
          name: t.name,
          fields: t.fields?.map((f: any) => ({ name: f.name, type: f.type })),
        })),
      });
    }

    // Default: show usage
    return res.json({
      error: 'action parameter required',
      actions: {
        'list-records': 'GET ?action=list-records&table=Features&view=Grid%20view&maxRecords=100',
        'get-record': 'GET ?action=get-record&table=Features&recordId=recXXX',
        'create-record': 'POST ?action=create-record&table=Features body: { fields: { Name: "...", Status: "..." } }',
        'update-record': 'PATCH ?action=update-record&table=Features&recordId=recXXX body: { fields: { Status: "..." } }',
        'delete-record': 'DELETE ?action=delete-record&table=Features&recordId=recXXX',
        'list-tables': 'GET ?action=list-tables (requires schema.bases:read scope)',
      },
      configured: {
        baseId: AIRTABLE_BASE_ID ? `${AIRTABLE_BASE_ID.slice(0, 6)}...` : 'NOT SET',
        tokenSet: !!AIRTABLE_TOKEN,
      },
    });

  } catch (error) {
    console.error('Airtable API error:', error);
    return res.status(500).json({ error: 'Server error', details: String(error) });
  }
}
