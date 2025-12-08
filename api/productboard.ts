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
      const { name, description, status, archived, owner, timeframe, parent } = body;

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
      if (parent !== undefined) payload.data.parent = parent;

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

    // Create component
    if (action === 'create-component') {
      const { name, description, productId, parentComponentId } = body;

      if (!name) {
        return res.status(400).json({
          error: 'name is required',
          example: {
            name: 'Component name',
            description: '<p>Component description</p>',
            productId: 'product-uuid (required if no parentComponentId)',
            parentComponentId: 'component-uuid (for subcomponents)'
          }
        });
      }

      if (!productId && !parentComponentId) {
        return res.status(400).json({
          error: 'Either productId or parentComponentId is required'
        });
      }

      const payload: any = {
        data: {
          name,
        }
      };

      if (description) payload.data.description = description;

      // Set parent - either product or component
      if (parentComponentId) {
        payload.data.parent = { component: { id: parentComponentId } };
      } else if (productId) {
        payload.data.parent = { product: { id: productId } };
      }

      const response = await fetch(`${PRODUCTBOARD_API_URL}/components`, {
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
    // AGENT-OPTIMIZED ACTIONS
    // =========================================================================

    // Get full hierarchy - products → components → features in one call
    if (action === 'get-hierarchy') {
      const [productsRes, componentsRes, featuresRes] = await Promise.all([
        fetch(`${PRODUCTBOARD_API_URL}/products`, { headers }),
        fetch(`${PRODUCTBOARD_API_URL}/components`, { headers }),
        fetch(`${PRODUCTBOARD_API_URL}/features?pageLimit=500`, { headers }),
      ]);

      const [productsData, componentsData, featuresData] = await Promise.all([
        productsRes.json(),
        componentsRes.json(),
        featuresRes.json(),
      ]);

      if (!productsRes.ok || !componentsRes.ok || !featuresRes.ok) {
        return res.status(500).json({ error: 'Failed to fetch hierarchy data' });
      }

      const products = productsData.data || [];
      const components = componentsData.data || [];
      const features = featuresData.data || [];

      // Build hierarchy
      const hierarchy = products.map((product: any) => {
        const productComponents = components.filter((c: any) =>
          c.parent?.product?.id === product.id
        );

        return {
          id: product.id,
          name: product.name,
          components: productComponents.map((comp: any) => {
            const compFeatures = features.filter((f: any) =>
              f.parent?.component?.id === comp.id
            );
            return {
              id: comp.id,
              name: comp.name,
              featureCount: compFeatures.length,
              features: compFeatures.map((f: any) => ({
                id: f.id,
                name: f.name,
                status: f.status?.name || 'No status',
              })),
            };
          }),
        };
      });

      // Find orphaned features (under product, not component)
      const orphaned = features.filter((f: any) =>
        f.parent?.product && !f.parent?.component
      );

      return res.json({
        success: true,
        hierarchy,
        summary: {
          products: products.length,
          components: components.length,
          features: features.length,
          orphanedFeatures: orphaned.length,
        },
        orphaned: orphaned.map((f: any) => ({
          id: f.id,
          name: f.name,
          parentProduct: f.parent?.product?.id,
        })),
      });
    }

    // Audit - check for orphaned features and organization issues
    if (action === 'audit') {
      const [productsRes, componentsRes, featuresRes] = await Promise.all([
        fetch(`${PRODUCTBOARD_API_URL}/products`, { headers }),
        fetch(`${PRODUCTBOARD_API_URL}/components`, { headers }),
        fetch(`${PRODUCTBOARD_API_URL}/features?pageLimit=500`, { headers }),
      ]);

      const [productsData, componentsData, featuresData] = await Promise.all([
        productsRes.json(),
        componentsRes.json(),
        featuresRes.json(),
      ]);

      const products = productsData.data || [];
      const components = componentsData.data || [];
      const features = featuresData.data || [];

      // Find issues
      const orphaned = features.filter((f: any) =>
        f.parent?.product && !f.parent?.component
      );

      const noParent = features.filter((f: any) =>
        !f.parent?.product && !f.parent?.component
      );

      // Group by component for balance check
      const componentFeatureCounts: Record<string, number> = {};
      for (const f of features) {
        const compId = f.parent?.component?.id;
        if (compId) {
          componentFeatureCounts[compId] = (componentFeatureCounts[compId] || 0) + 1;
        }
      }

      // Find empty components
      const emptyComponents = components.filter((c: any) =>
        !componentFeatureCounts[c.id]
      );

      const issues: string[] = [];
      if (orphaned.length > 0) {
        issues.push(`${orphaned.length} features under products instead of components`);
      }
      if (noParent.length > 0) {
        issues.push(`${noParent.length} features with no parent`);
      }
      if (emptyComponents.length > 0) {
        issues.push(`${emptyComponents.length} empty components`);
      }

      return res.json({
        success: true,
        healthy: issues.length === 0,
        issues,
        summary: {
          products: products.length,
          components: components.length,
          features: features.length,
          orphanedFeatures: orphaned.length,
          noParentFeatures: noParent.length,
          emptyComponents: emptyComponents.length,
        },
        orphaned: orphaned.map((f: any) => ({ id: f.id, name: f.name })),
        emptyComponents: emptyComponents.map((c: any) => ({ id: c.id, name: c.name })),
      });
    }

    // Batch delete features
    if (action === 'batch-delete') {
      const { featureIds } = body;

      if (!featureIds || !Array.isArray(featureIds) || featureIds.length === 0) {
        return res.status(400).json({
          error: 'featureIds array required',
          example: { featureIds: ['id1', 'id2', 'id3'] }
        });
      }

      const results: { id: string; success: boolean; error?: string }[] = [];

      // Delete in sequence with small delay to avoid rate limiting
      for (const id of featureIds) {
        try {
          const response = await fetch(`${PRODUCTBOARD_API_URL}/features/${id}`, {
            method: 'DELETE',
            headers,
          });

          if (response.ok) {
            results.push({ id, success: true });
          } else {
            const data = await response.json();
            results.push({ id, success: false, error: data.message || 'Delete failed' });
          }
        } catch (err) {
          results.push({ id, success: false, error: String(err) });
        }

        // Small delay between requests
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      const succeeded = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;

      return res.json({
        success: failed === 0,
        deleted: succeeded,
        failed,
        results,
      });
    }

    // Move feature (delete + recreate under new component)
    if (action === 'move-feature') {
      const { featureId, targetComponentId } = body;

      if (!featureId || !targetComponentId) {
        return res.status(400).json({
          error: 'featureId and targetComponentId required',
          example: { featureId: 'xxx', targetComponentId: 'yyy' }
        });
      }

      // Get existing feature
      const getRes = await fetch(`${PRODUCTBOARD_API_URL}/features/${featureId}`, { headers });
      if (!getRes.ok) {
        return res.status(404).json({ error: 'Feature not found' });
      }
      const existing = (await getRes.json()).data;

      // Delete old feature
      const deleteRes = await fetch(`${PRODUCTBOARD_API_URL}/features/${featureId}`, {
        method: 'DELETE',
        headers,
      });
      if (!deleteRes.ok) {
        return res.status(500).json({ error: 'Failed to delete original feature' });
      }

      // Recreate under new component
      const createPayload = {
        data: {
          name: existing.name,
          description: existing.description,
          type: existing.type || 'feature',
          status: existing.status,
          parent: { component: { id: targetComponentId } },
        }
      };

      const createRes = await fetch(`${PRODUCTBOARD_API_URL}/features`, {
        method: 'POST',
        headers,
        body: JSON.stringify(createPayload),
      });
      const created = await createRes.json();

      if (!createRes.ok) {
        return res.status(500).json({
          error: 'Deleted original but failed to create new',
          deletedId: featureId,
          createError: created,
        });
      }

      return res.json({
        success: true,
        movedFrom: featureId,
        movedTo: created.data.id,
        feature: created.data,
      });
    }

    // Resolve component by name - find component ID from name
    if (action === 'resolve-component') {
      const { componentName, productName } = req.query;

      if (!componentName) {
        return res.status(400).json({ error: 'componentName parameter required' });
      }

      const [productsRes, componentsRes] = await Promise.all([
        fetch(`${PRODUCTBOARD_API_URL}/products`, { headers }),
        fetch(`${PRODUCTBOARD_API_URL}/components`, { headers }),
      ]);

      const products = (await productsRes.json()).data || [];
      const components = (await componentsRes.json()).data || [];

      // Filter by product if specified
      let filtered = components;
      if (productName) {
        const product = products.find((p: any) =>
          p.name.toLowerCase() === (productName as string).toLowerCase()
        );
        if (product) {
          filtered = components.filter((c: any) =>
            c.parent?.product?.id === product.id
          );
        }
      }

      // Find matching component
      const match = filtered.find((c: any) =>
        c.name.toLowerCase() === (componentName as string).toLowerCase()
      );

      if (!match) {
        return res.json({
          success: false,
          error: 'Component not found',
          available: filtered.map((c: any) => c.name),
        });
      }

      return res.json({
        success: true,
        component: {
          id: match.id,
          name: match.name,
          productId: match.parent?.product?.id,
        },
      });
    }

    // Get reference data - products, components, statuses in one call
    if (action === 'get-reference') {
      const [productsRes, componentsRes, statusesRes] = await Promise.all([
        fetch(`${PRODUCTBOARD_API_URL}/products`, { headers }),
        fetch(`${PRODUCTBOARD_API_URL}/components`, { headers }),
        fetch(`${PRODUCTBOARD_API_URL}/feature-statuses`, { headers }),
      ]);

      const [productsData, componentsData, statusesData] = await Promise.all([
        productsRes.json(),
        componentsRes.json(),
        statusesRes.json(),
      ]);

      const products = productsData.data || [];
      const components = componentsData.data || [];
      const statuses = statusesData.data || [];

      // Build lookup tables
      const productLookup: Record<string, string> = {};
      const componentLookup: Record<string, string> = {};
      const statusLookup: Record<string, string> = {};

      for (const p of products) {
        productLookup[p.name] = p.id;
      }
      for (const c of components) {
        componentLookup[c.name] = c.id;
      }
      for (const s of statuses) {
        statusLookup[s.name] = s.id;
      }

      return res.json({
        success: true,
        products: productLookup,
        components: componentLookup,
        statuses: statusLookup,
        raw: {
          products,
          components,
          statuses,
        },
      });
    }

    // =========================================================================
    // SMART QUERY ACTIONS - For sales and engineering questions
    // =========================================================================

    // Search features by keyword - returns matched features with context
    if (action === 'search') {
      const { q, query } = req.query;
      const searchQuery = (q || query || '') as string;

      if (!searchQuery) {
        return res.status(400).json({
          error: 'Search query required',
          example: '?action=search&q=live tracking'
        });
      }

      // Fetch all features
      const response = await fetch(`${PRODUCTBOARD_API_URL}/features?pageLimit=500`, { headers });
      const data = await response.json();
      const features = data.data || [];

      // Search in name and description
      const searchTerms = searchQuery.toLowerCase().split(/\s+/);
      const matches = features.filter((f: any) => {
        const name = (f.name || '').toLowerCase();
        const desc = (f.description || '').toLowerCase();
        const combined = `${name} ${desc}`;
        return searchTerms.some(term => combined.includes(term));
      });

      // Score and sort by relevance (more term matches = higher score)
      const scored = matches.map((f: any) => {
        const name = (f.name || '').toLowerCase();
        const desc = (f.description || '').toLowerCase();
        let score = 0;
        for (const term of searchTerms) {
          if (name.includes(term)) score += 3; // Name matches worth more
          if (desc.includes(term)) score += 1;
        }
        return { ...f, _score: score };
      });

      scored.sort((a: any, b: any) => b._score - a._score);

      return res.json({
        success: true,
        query: searchQuery,
        count: scored.length,
        features: scored.slice(0, 20).map((f: any) => ({
          id: f.id,
          name: f.name,
          description: f.description?.replace(/<[^>]*>/g, '').substring(0, 200),
          status: f.status?.name || 'No status',
          product: f.parent?.product?.id || f.parent?.component?.product?.id,
          component: f.parent?.component?.id,
          relevance: f._score
        }))
      });
    }

    // Current features - what we have today (Released or In progress)
    if (action === 'current-features') {
      const { productName } = req.query;

      const [featuresRes, productsRes, componentsRes] = await Promise.all([
        fetch(`${PRODUCTBOARD_API_URL}/features?pageLimit=500`, { headers }),
        fetch(`${PRODUCTBOARD_API_URL}/products`, { headers }),
        fetch(`${PRODUCTBOARD_API_URL}/components`, { headers }),
      ]);

      const features = (await featuresRes.json()).data || [];
      const products = (await productsRes.json()).data || [];
      const components = (await componentsRes.json()).data || [];

      // Build lookups
      const productMap = new Map(products.map((p: any) => [p.id, p.name]));
      const componentMap = new Map(components.map((c: any) => [c.id, { name: c.name, productId: c.parent?.product?.id }]));

      // Filter to current features (Released, In progress, or no status = available)
      const currentStatuses = ['released', 'in progress', 'new idea'];
      let current = features.filter((f: any) => {
        const status = (f.status?.name || '').toLowerCase();
        return currentStatuses.some(s => status.includes(s)) || !f.status;
      });

      // Filter by product name if provided
      if (productName) {
        const targetProduct = products.find((p: any) =>
          p.name.toLowerCase().includes((productName as string).toLowerCase())
        );
        if (targetProduct) {
          current = current.filter((f: any) =>
            f.parent?.product?.id === targetProduct.id ||
            componentMap.get(f.parent?.component?.id)?.productId === targetProduct.id
          );
        }
      }

      // Group by product
      const byProduct: Record<string, any[]> = {};
      for (const f of current) {
        const productId = f.parent?.product?.id || componentMap.get(f.parent?.component?.id)?.productId;
        const productNameResolved = productMap.get(productId) || 'Uncategorized';
        if (!byProduct[productNameResolved]) byProduct[productNameResolved] = [];
        byProduct[productNameResolved].push({
          name: f.name,
          status: f.status?.name || 'Available',
          component: componentMap.get(f.parent?.component?.id)?.name || 'General'
        });
      }

      return res.json({
        success: true,
        summary: `${current.length} current features across ${Object.keys(byProduct).length} products`,
        byProduct,
        note: 'These are features currently available or in active development'
      });
    }

    // Roadmap - what's planned
    if (action === 'roadmap') {
      const { productName } = req.query;

      const [featuresRes, productsRes, componentsRes, statusesRes] = await Promise.all([
        fetch(`${PRODUCTBOARD_API_URL}/features?pageLimit=500`, { headers }),
        fetch(`${PRODUCTBOARD_API_URL}/products`, { headers }),
        fetch(`${PRODUCTBOARD_API_URL}/components`, { headers }),
        fetch(`${PRODUCTBOARD_API_URL}/feature-statuses`, { headers }),
      ]);

      const features = (await featuresRes.json()).data || [];
      const products = (await productsRes.json()).data || [];
      const components = (await componentsRes.json()).data || [];
      const statuses = (await statusesRes.json()).data || [];

      // Build lookups
      const productMap = new Map(products.map((p: any) => [p.id, p.name]));
      const componentMap = new Map(components.map((c: any) => [c.id, { name: c.name, productId: c.parent?.product?.id }]));

      // Filter by product if specified
      let filtered = features;
      if (productName) {
        const targetProduct = products.find((p: any) =>
          p.name.toLowerCase().includes((productName as string).toLowerCase())
        );
        if (targetProduct) {
          filtered = features.filter((f: any) =>
            f.parent?.product?.id === targetProduct.id ||
            componentMap.get(f.parent?.component?.id)?.productId === targetProduct.id
          );
        }
      }

      // Group by status
      const byStatus: Record<string, any[]> = {};
      for (const f of filtered) {
        const statusName = f.status?.name || 'No status';
        if (!byStatus[statusName]) byStatus[statusName] = [];
        const productId = f.parent?.product?.id || componentMap.get(f.parent?.component?.id)?.productId;
        byStatus[statusName].push({
          name: f.name,
          product: productMap.get(productId) || 'Unknown',
          component: componentMap.get(f.parent?.component?.id)?.name,
          timeframe: f.timeframe?.startDate ? `${f.timeframe.startDate} - ${f.timeframe.endDate || 'TBD'}` : null
        });
      }

      // Order statuses logically
      const statusOrder = ['New idea', 'Candidate', 'Planned', 'In progress', 'Released'];
      const orderedRoadmap: Record<string, any[]> = {};
      for (const status of statusOrder) {
        if (byStatus[status]) orderedRoadmap[status] = byStatus[status];
      }
      // Add any remaining statuses
      for (const [status, items] of Object.entries(byStatus)) {
        if (!orderedRoadmap[status]) orderedRoadmap[status] = items;
      }

      return res.json({
        success: true,
        summary: `${filtered.length} features in roadmap`,
        statusCounts: Object.fromEntries(
          Object.entries(orderedRoadmap).map(([k, v]) => [k, v.length])
        ),
        roadmap: orderedRoadmap,
        statuses: statuses.map((s: any) => s.name)
      });
    }

    // Answer sales questions - formatted responses for common queries
    if (action === 'sales-answer') {
      const { question } = req.query;
      const q = (question || '') as string;

      if (!q) {
        return res.status(400).json({
          error: 'Question required',
          examples: [
            '?action=sales-answer&question=what features do we offer',
            '?action=sales-answer&question=what is on the roadmap',
            '?action=sales-answer&question=shop dashboard capabilities'
          ]
        });
      }

      // Fetch all data
      const [featuresRes, productsRes, componentsRes] = await Promise.all([
        fetch(`${PRODUCTBOARD_API_URL}/features?pageLimit=500`, { headers }),
        fetch(`${PRODUCTBOARD_API_URL}/products`, { headers }),
        fetch(`${PRODUCTBOARD_API_URL}/components`, { headers }),
      ]);

      const features = (await featuresRes.json()).data || [];
      const products = (await productsRes.json()).data || [];
      const components = (await componentsRes.json()).data || [];

      const productMap = new Map(products.map((p: any) => [p.id, p.name]));
      const componentMap = new Map(components.map((c: any) => [c.id, { name: c.name, productId: c.parent?.product?.id }]));

      const qLower = q.toLowerCase();

      // Detect question type and product focus
      const isRoadmapQuestion = /roadmap|planned|upcoming|future|coming soon|when|timeline/i.test(q);
      const isCurrentQuestion = /current|now|today|offer|have|available|capabilities/i.test(q);

      // Detect product focus
      let productFocus: string | null = null;
      if (/consumer|app|mobile/i.test(q)) productFocus = 'Consumer App';
      if (/shop|dashboard|portal/i.test(q)) productFocus = 'Shop Dashboard';
      if (/backend|database|cartel|api/i.test(q)) productFocus = 'CarTelDB';

      // Search for relevant features
      const searchTerms = qLower.split(/\s+/).filter(t => t.length > 2 && !['what', 'the', 'are', 'does', 'have', 'offer'].includes(t));

      let relevantFeatures = features;

      // Filter by product focus
      if (productFocus) {
        const targetProduct = products.find((p: any) => p.name === productFocus);
        if (targetProduct) {
          relevantFeatures = features.filter((f: any) =>
            f.parent?.product?.id === targetProduct.id ||
            componentMap.get(f.parent?.component?.id)?.productId === targetProduct.id
          );
        }
      }

      // Filter by search terms
      if (searchTerms.length > 0) {
        relevantFeatures = relevantFeatures.filter((f: any) => {
          const name = (f.name || '').toLowerCase();
          const desc = (f.description || '').toLowerCase();
          return searchTerms.some(term => name.includes(term) || desc.includes(term));
        });
      }

      // Build response
      const response: any = {
        success: true,
        question: q,
        productFocus,
        questionType: isRoadmapQuestion ? 'roadmap' : isCurrentQuestion ? 'current' : 'general',
      };

      if (relevantFeatures.length === 0 && searchTerms.length > 0) {
        // No specific matches, return product overview
        response.answer = `No specific features found matching "${searchTerms.join(' ')}". Here's an overview:`;
        response.products = products.map((p: any) => ({
          name: p.name,
          featureCount: features.filter((f: any) =>
            f.parent?.product?.id === p.id ||
            componentMap.get(f.parent?.component?.id)?.productId === p.id
          ).length
        }));
      } else {
        // Group relevant features by component
        const byComponent: Record<string, any[]> = {};
        for (const f of relevantFeatures) {
          const compInfo = componentMap.get(f.parent?.component?.id);
          const compName = compInfo?.name || 'General';
          if (!byComponent[compName]) byComponent[compName] = [];
          byComponent[compName].push({
            name: f.name,
            status: f.status?.name || 'Available',
            description: f.description?.replace(/<[^>]*>/g, '').substring(0, 150)
          });
        }

        response.answer = `Found ${relevantFeatures.length} relevant features${productFocus ? ` in ${productFocus}` : ''}`;
        response.featureCount = relevantFeatures.length;
        response.byComponent = byComponent;
      }

      return res.json(response);
    }

    // Product summary - quick overview for a product
    if (action === 'product-summary') {
      const { productName, productId } = req.query;

      if (!productName && !productId) {
        return res.status(400).json({
          error: 'productName or productId required',
          example: '?action=product-summary&productName=Consumer App'
        });
      }

      const [featuresRes, productsRes, componentsRes] = await Promise.all([
        fetch(`${PRODUCTBOARD_API_URL}/features?pageLimit=500`, { headers }),
        fetch(`${PRODUCTBOARD_API_URL}/products`, { headers }),
        fetch(`${PRODUCTBOARD_API_URL}/components`, { headers }),
      ]);

      const features = (await featuresRes.json()).data || [];
      const products = (await productsRes.json()).data || [];
      const components = (await componentsRes.json()).data || [];

      // Find target product
      const targetProduct = productId
        ? products.find((p: any) => p.id === productId)
        : products.find((p: any) => p.name.toLowerCase().includes((productName as string).toLowerCase()));

      if (!targetProduct) {
        return res.status(404).json({
          error: 'Product not found',
          availableProducts: products.map((p: any) => p.name)
        });
      }

      // Get components for this product
      const productComponents = components.filter((c: any) => c.parent?.product?.id === targetProduct.id);

      // Get features for this product
      const productFeatures = features.filter((f: any) =>
        f.parent?.product?.id === targetProduct.id ||
        productComponents.some((c: any) => c.id === f.parent?.component?.id)
      );

      // Group by component and status
      const byComponent: Record<string, { features: any[], statusCounts: Record<string, number> }> = {};

      for (const comp of productComponents) {
        const compFeatures = productFeatures.filter((f: any) => f.parent?.component?.id === comp.id);
        const statusCounts: Record<string, number> = {};
        for (const f of compFeatures) {
          const status = f.status?.name || 'No status';
          statusCounts[status] = (statusCounts[status] || 0) + 1;
        }
        byComponent[comp.name] = {
          features: compFeatures.map((f: any) => ({
            name: f.name,
            status: f.status?.name || 'No status'
          })),
          statusCounts
        };
      }

      // Overall status counts
      const overallStatusCounts: Record<string, number> = {};
      for (const f of productFeatures) {
        const status = f.status?.name || 'No status';
        overallStatusCounts[status] = (overallStatusCounts[status] || 0) + 1;
      }

      return res.json({
        success: true,
        product: {
          id: targetProduct.id,
          name: targetProduct.name,
          description: targetProduct.description?.replace(/<[^>]*>/g, '')
        },
        summary: {
          totalFeatures: productFeatures.length,
          components: productComponents.length,
          statusBreakdown: overallStatusCounts
        },
        components: byComponent
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
        'create-component': 'POST ?action=create-component body: { name, description, productId, parentComponentId }',
        // Notes
        'create-note': 'POST ?action=create-note body: { title, content, customerEmail, tags }',
        'list-notes': 'GET ?action=list-notes&limit=50',
        // Reference
        'list-statuses': 'GET ?action=list-statuses',
        'list-releases': 'GET ?action=list-releases',
        'list-companies': 'GET ?action=list-companies',
        // Agent-optimized
        'get-hierarchy': 'GET ?action=get-hierarchy (full product→component→feature tree)',
        'audit': 'GET ?action=audit (check for orphaned features)',
        'batch-delete': 'POST ?action=batch-delete body: { featureIds: [...] }',
        'move-feature': 'POST ?action=move-feature body: { featureId, targetComponentId }',
        'resolve-component': 'GET ?action=resolve-component&componentName=xxx&productName=yyy',
        'get-reference': 'GET ?action=get-reference (products, components, statuses lookup)',
        // Smart query actions (for sales/engineering questions)
        'search': 'GET ?action=search&q=live tracking (keyword search with relevance)',
        'current-features': 'GET ?action=current-features&productName=Consumer App (what we have today)',
        'roadmap': 'GET ?action=roadmap&productName=Shop Dashboard (planned features by status)',
        'sales-answer': 'GET ?action=sales-answer&question=what features does shop dashboard have',
        'product-summary': 'GET ?action=product-summary&productName=Consumer App (quick overview)',
      },
      configured: !!PRODUCTBOARD_TOKEN,
      docs: 'https://developer.productboard.com/reference/introduction',
    });

  } catch (error) {
    console.error('ProductBoard API error:', error);
    return res.status(500).json({ error: 'Server error', details: String(error) });
  }
}

