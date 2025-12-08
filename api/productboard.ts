import type { VercelRequest, VercelResponse } from '@vercel/node';

const PRODUCTBOARD_API_URL = 'https://api.productboard.com';
const PRODUCTBOARD_TOKEN = process.env.PRODUCTBOARD_API_TOKEN || process.env.PRODUCTBOARD_API_KEY;

/**
 * ProductBoard Integration API
 *
 * Enables agents to manage features, notes, and product roadmap in ProductBoard.
 *
 * Required env vars:
 * - PRODUCTBOARD_API_TOKEN: API token from ProductBoard workspace settings
 *
 * API Reference: https://developer.productboard.com/reference/introduction
 *
 * Actions:
 * - list-features: Get all features with optional filters
 * - get-feature: Get a specific feature by ID
 * - create-feature: Create a new feature
 * - update-feature: Update an existing feature
 * - delete-feature: Delete a feature
 * - list-products: Get all products
 * - list-components: Get all components
 * - create-note: Create a new note (feedback/idea)
 * - list-notes: Get notes
 * - list-statuses: Get available feature statuses
 * - list-releases: Get releases
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (!PRODUCTBOARD_TOKEN) {
    return res.status(500).json({
      error: 'PRODUCTBOARD_API_TOKEN not configured',
      setup: {
        steps: [
          '1. Go to ProductBoard → Settings → Integrations → Public API',
          '2. Generate a new API token',
          '3. Add PRODUCTBOARD_API_TOKEN to Vercel environment variables'
        ],
        docs: 'https://developer.productboard.com/reference/introduction'
      }
    });
  }

  const headers = {
    'Authorization': `Bearer ${PRODUCTBOARD_TOKEN}`,
    'Content-Type': 'application/json',
    'X-Version': '1',
  };

  try {
    const { action } = req.query;
    let body: any = {};

    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
      try {
        body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      } catch (e) {
        return res.status(400).json({ error: 'Invalid JSON body' });
      }
    }

    // =========================================================================
    // FEATURES
    // =========================================================================

    // List features
    // Note: Productboard API v1 doesn't support filtering by product.id or component.id
    // We fetch all features and filter client-side if needed
    if (action === 'list-features') {
      const { status, productId, limit = '100', cursor } = req.query;
      const params = new URLSearchParams();

      if (limit) params.append('pageLimit', limit as string);
      if (cursor) params.append('pageCursor', cursor as string);

      // Only status filter is supported server-side
      const filters: string[] = [];
      if (status) filters.push(`status.name=${encodeURIComponent(status as string)}`);

      let url = `${PRODUCTBOARD_API_URL}/features`;
      if (filters.length > 0) {
        url += `?${filters.join('&')}`;
        if (params.toString()) url += `&${params}`;
      } else if (params.toString()) {
        url += `?${params}`;
      }

      const response = await fetch(url, { headers });
      const data = await response.json();

      if (!response.ok) {
        return res.status(response.status).json({ error: 'ProductBoard API error', details: data });
      }

      // Filter by productId client-side if provided
      let features = data.data || [];
      if (productId) {
        features = features.filter((f: any) =>
          f.parent?.product?.id === productId ||
          f.parent?.component?.product?.id === productId
        );
      }

      return res.json({
        success: true,
        features,
        links: data.links, // pagination
        count: features.length,
        note: productId ? 'Filtered client-side by product' : undefined,
      });
    }

    // Get single feature
    if (action === 'get-feature') {
      const { featureId } = req.query;
      if (!featureId) {
        return res.status(400).json({ error: 'featureId parameter required' });
      }

      const response = await fetch(`${PRODUCTBOARD_API_URL}/features/${featureId}`, { headers });
      const data = await response.json();

      if (!response.ok) {
        return res.status(response.status).json({ error: 'ProductBoard API error', details: data });
      }

      return res.json({
        success: true,
        feature: data.data,
      });
    }

    // Create feature
    if (action === 'create-feature') {
      const { name, description, status, parent, owner, timeframe, type = 'feature' } = body;

      if (!name) {
        return res.status(400).json({
          error: 'name is required',
          example: {
            name: 'Feature name',
            description: '<p>Feature description</p>',
            type: 'feature', // or 'subfeature'
            status: { id: 'status-uuid' }, // Use list-statuses to get IDs
            parent: { product: { id: 'product-uuid' } },
            owner: { email: 'owner@example.com' }
          }
        });
      }

      // Default status to "New idea" if not provided
      const defaultStatusId = 'dedf0732-362a-4aca-b226-04e341893e92';

      const payload: any = {
        data: {
          name,
          type,
          status: status || { id: defaultStatusId },
        }
      };

      if (description) payload.data.description = description;
      if (parent) payload.data.parent = parent;
      if (owner) payload.data.owner = owner;
      if (timeframe) payload.data.timeframe = timeframe;

      const response = await fetch(`${PRODUCTBOARD_API_URL}/features`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });
      const data = await response.json();

      if (!response.ok) {
        return res.status(response.status).json({ error: 'ProductBoard API error', details: data });
      }

      return res.json({
        success: true,
        created: data.data,
      });
    }

    // Update feature
    if (action === 'update-feature') {
      const { featureId } = req.query;
      const { name, description, status, archived, owner, timeframe } = body;

      if (!featureId) {
        return res.status(400).json({ error: 'featureId query parameter required' });
      }

      const payload: any = { data: {} };
      if (name !== undefined) payload.data.name = name;
      if (description !== undefined) payload.data.description = description;
      if (status !== undefined) payload.data.status = status;
      if (archived !== undefined) payload.data.archived = archived;
      if (owner !== undefined) payload.data.owner = owner;
      if (timeframe !== undefined) payload.data.timeframe = timeframe;

      const response = await fetch(`${PRODUCTBOARD_API_URL}/features/${featureId}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(payload),
      });
      const data = await response.json();

      if (!response.ok) {
        return res.status(response.status).json({ error: 'ProductBoard API error', details: data });
      }

      return res.json({
        success: true,
        updated: data.data,
      });
    }

    // Delete feature
    if (action === 'delete-feature') {
      const { featureId } = req.query;
      if (!featureId) {
        return res.status(400).json({ error: 'featureId parameter required' });
      }

      const response = await fetch(`${PRODUCTBOARD_API_URL}/features/${featureId}`, {
        method: 'DELETE',
        headers,
      });

      if (!response.ok) {
        const data = await response.json();
        return res.status(response.status).json({ error: 'ProductBoard API error', details: data });
      }

      return res.json({
        success: true,
        deleted: featureId,
      });
    }

    // =========================================================================
    // PRODUCTS & COMPONENTS
    // =========================================================================

    // List products
    if (action === 'list-products') {
      const response = await fetch(`${PRODUCTBOARD_API_URL}/products`, { headers });
      const data = await response.json();

      if (!response.ok) {
        return res.status(response.status).json({ error: 'ProductBoard API error', details: data });
      }

      return res.json({
        success: true,
        products: data.data,
        count: data.data?.length || 0,
      });
    }

    // Get single product
    if (action === 'get-product') {
      const { productId } = req.query;
      if (!productId) {
        return res.status(400).json({ error: 'productId parameter required' });
      }

      const response = await fetch(`${PRODUCTBOARD_API_URL}/products/${productId}`, { headers });
      const data = await response.json();

      if (!response.ok) {
        return res.status(response.status).json({ error: 'ProductBoard API error', details: data });
      }

      return res.json({
        success: true,
        product: data.data,
      });
    }

    // Update product
    if (action === 'update-product') {
      const { productId } = req.query;
      const { name, description } = body;

      if (!productId) {
        return res.status(400).json({ error: 'productId query parameter required' });
      }

      const payload: any = { data: {} };
      if (name !== undefined) payload.data.name = name;
      if (description !== undefined) payload.data.description = description;

      const response = await fetch(`${PRODUCTBOARD_API_URL}/products/${productId}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(payload),
      });
      const data = await response.json();

      if (!response.ok) {
        return res.status(response.status).json({ error: 'ProductBoard API error', details: data });
      }

      return res.json({
        success: true,
        updated: data.data,
      });
    }

    // List components
    if (action === 'list-components') {
      const { productId } = req.query;
      let url = `${PRODUCTBOARD_API_URL}/components`;
      if (productId) {
        url += `?product.id=${productId}`;
      }

      const response = await fetch(url, { headers });
      const data = await response.json();

      if (!response.ok) {
        return res.status(response.status).json({ error: 'ProductBoard API error', details: data });
      }

      return res.json({
        success: true,
        components: data.data,
        count: data.data?.length || 0,
      });
    }

    // =========================================================================
    // NOTES (Insights/Feedback)
    // =========================================================================

    // Create note
    if (action === 'create-note') {
      const { title, content, customerEmail, companyName, source, tags, displayUrl } = body;

      if (!title && !content) {
        return res.status(400).json({
          error: 'title or content is required',
          example: {
            title: 'Customer feedback',
            content: '<p>User requested feature X</p>',
            customerEmail: 'customer@example.com',
            companyName: 'Acme Inc',
            source: { origin: 'agent-coord-hub' },
            tags: ['feedback', 'feature-request']
          }
        });
      }

      const payload: any = {
        data: {}
      };

      if (title) payload.data.title = title;
      if (content) payload.data.content = content;
      if (customerEmail) payload.data.user = { email: customerEmail };
      if (companyName) payload.data.company = { name: companyName };
      if (displayUrl) payload.data.displayUrl = displayUrl;
      if (source) payload.data.source = source;
      if (tags && Array.isArray(tags)) {
        payload.data.tags = tags.map((t: string) => ({ name: t }));
      }

      const response = await fetch(`${PRODUCTBOARD_API_URL}/notes`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });
      const data = await response.json();

      if (!response.ok) {
        return res.status(response.status).json({ error: 'ProductBoard API error', details: data });
      }

      return res.json({
        success: true,
        created: data.data,
      });
    }

    // List notes
    if (action === 'list-notes') {
      const { limit = '50', cursor } = req.query;
      const params = new URLSearchParams();
      if (limit) params.append('pageLimit', limit as string);
      if (cursor) params.append('pageCursor', cursor as string);

      const response = await fetch(`${PRODUCTBOARD_API_URL}/notes?${params}`, { headers });
      const data = await response.json();

      if (!response.ok) {
        return res.status(response.status).json({ error: 'ProductBoard API error', details: data });
      }

      return res.json({
        success: true,
        notes: data.data,
        links: data.links,
        count: data.data?.length || 0,
      });
    }

    // =========================================================================
    // STATUSES & RELEASES
    // =========================================================================

    // List feature statuses
    if (action === 'list-statuses') {
      const response = await fetch(`${PRODUCTBOARD_API_URL}/feature-statuses`, { headers });
      const data = await response.json();

      if (!response.ok) {
        return res.status(response.status).json({ error: 'ProductBoard API error', details: data });
      }

      return res.json({
        success: true,
        statuses: data.data,
        count: data.data?.length || 0,
      });
    }

    // List releases
    if (action === 'list-releases') {
      const response = await fetch(`${PRODUCTBOARD_API_URL}/releases`, { headers });
      const data = await response.json();

      if (!response.ok) {
        return res.status(response.status).json({ error: 'ProductBoard API error', details: data });
      }

      return res.json({
        success: true,
        releases: data.data,
        count: data.data?.length || 0,
      });
    }

    // =========================================================================
    // COMPANIES & USERS
    // =========================================================================

    // List companies
    if (action === 'list-companies') {
      const { limit = '50', cursor } = req.query;
      const params = new URLSearchParams();
      if (limit) params.append('pageLimit', limit as string);
      if (cursor) params.append('pageCursor', cursor as string);

      const response = await fetch(`${PRODUCTBOARD_API_URL}/companies?${params}`, { headers });
      const data = await response.json();

      if (!response.ok) {
        return res.status(response.status).json({ error: 'ProductBoard API error', details: data });
      }

      return res.json({
        success: true,
        companies: data.data,
        links: data.links,
        count: data.data?.length || 0,
      });
    }

    // =========================================================================
    // DEFAULT: Show usage
    // =========================================================================

    return res.json({
      error: 'action parameter required',
      actions: {
        // Features
        'list-features': 'GET ?action=list-features&status=Planned&productId=xxx&limit=100',
        'get-feature': 'GET ?action=get-feature&featureId=xxx',
        'create-feature': 'POST ?action=create-feature body: { name, description, status, parent, owner }',
        'update-feature': 'PUT ?action=update-feature&featureId=xxx body: { name, description, status, archived }',
        'delete-feature': 'DELETE ?action=delete-feature&featureId=xxx',
        // Products & Components
        'list-products': 'GET ?action=list-products',
        'get-product': 'GET ?action=get-product&productId=xxx',
        'update-product': 'PUT ?action=update-product&productId=xxx body: { name, description }',
        'list-components': 'GET ?action=list-components&productId=xxx',
        // Notes
        'create-note': 'POST ?action=create-note body: { title, content, customerEmail, tags }',
        'list-notes': 'GET ?action=list-notes&limit=50',
        // Reference
        'list-statuses': 'GET ?action=list-statuses',
        'list-releases': 'GET ?action=list-releases',
        'list-companies': 'GET ?action=list-companies',
      },
      configured: !!PRODUCTBOARD_TOKEN,
      docs: 'https://developer.productboard.com/reference/introduction',
    });

  } catch (error) {
    console.error('ProductBoard API error:', error);
    return res.status(500).json({ error: 'Server error', details: String(error) });
  }
}
