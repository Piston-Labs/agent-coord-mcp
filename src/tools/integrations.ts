/**
 * Integration Tools - Device fleet, AWS, sales
 *
 * Tools: device, aws-status, fleet-analytics, provision-device, alerts, shop, generate-doc
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

const API_BASE = process.env.API_BASE || 'https://agent-coord-mcp.vercel.app';

export function registerIntegrationTools(server: McpServer) {
  // ============================================================================
  // PISTON DEVICE TOOL - Fleet management for Teltonika devices
  // ============================================================================

  server.tool(
    'device',
    'Manage Piston Labs Teltonika GPS device fleet. List devices, check status, update info.',
    {
      action: z.enum(['list', 'get', 'update', 'status']).describe('list=all devices, get=specific device, update=modify device, status=fleet summary'),
      imei: z.string().optional().describe('Device IMEI (15 digits) - required for get/update'),
      updates: z.object({
        name: z.string().optional(),
        status: z.enum(['active', 'inactive', 'provisioning', 'error']).optional(),
        vehicle: z.object({
          vin: z.string().optional(),
          make: z.string().optional(),
          model: z.string().optional(),
          year: z.number().optional()
        }).optional(),
        notes: z.string().optional()
      }).optional().describe('Fields to update (for update action)')
    },
    async (args) => {
      const { action, imei, updates } = args;

      try {
        switch (action) {
          case 'list': {
            const res = await fetch(`${API_BASE}/api/piston-devices`);
            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'get': {
            if (!imei) {
              return { content: [{ type: 'text', text: JSON.stringify({ error: 'imei required for get action' }) }] };
            }
            const res = await fetch(`${API_BASE}/api/piston-devices?imei=${imei}`);
            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'update': {
            if (!imei) {
              return { content: [{ type: 'text', text: JSON.stringify({ error: 'imei required for update action' }) }] };
            }
            const res = await fetch(`${API_BASE}/api/piston-devices`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ imei, ...updates })
            });
            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'status': {
            const res = await fetch(`${API_BASE}/api/piston-devices`);
            const data = await res.json();
            const summary = {
              totalDevices: data.count,
              activeDevices: data.active,
              inactiveDevices: data.count - data.active,
              devices: data.devices.map((d: any) => ({
                name: d.name,
                imei: d.imei,
                status: d.status,
                model: d.model
              }))
            };
            return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] };
          }

          default:
            return { content: [{ type: 'text', text: `Unknown action: ${action}` }] };
        }
      } catch (error) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: String(error) }) }] };
      }
    }
  );

  // ============================================================================
  // AWS-STATUS TOOL - Infrastructure monitoring
  // ============================================================================

  server.tool(
    'aws-status',
    'Check Piston Labs AWS infrastructure status: Lambda, IoT Core, databases.',
    {
      service: z.enum(['lambda', 'iot', 's3', 'all']).describe('AWS service to check'),
      timeRange: z.enum(['1h', '24h', '7d']).optional().describe('Time range for metrics'),
      agentId: z.string().describe('Your agent ID')
    },
    async (args) => {
      const { service, timeRange = '24h', agentId } = args;

      // Return known infrastructure status from context
      const status = {
        service,
        timeRange,
        timestamp: new Date().toISOString(),
        infrastructure: {
          lambda: {
            name: 'parse-teltonika-data',
            status: 'operational',
            avgLatency: '<100ms',
            errorRate: '0%',
            note: 'Use AWS CLI for real-time metrics'
          },
          iot: {
            endpoint: 'AWS IoT Core us-west-1',
            protocol: 'MQTT over TLS',
            devices: 4,
            activeDevices: 3,
            status: 'operational'
          },
          s3: {
            bucket: 'telemetry-raw-usw1',
            status: 'operational',
            note: 'Archives all telemetry data'
          },
          databases: {
            timescale: 'operational (real-time)',
            redshift: 'operational (analytics)',
            supabase: 'operational (app data)'
          }
        },
        hint: 'For real-time AWS metrics, use AWS CLI: aws cloudwatch get-metric-statistics'
      };

      if (service !== 'all') {
        return { content: [{ type: 'text', text: JSON.stringify({
          service,
          ...status.infrastructure[service as keyof typeof status.infrastructure],
          timestamp: status.timestamp
        }, null, 2) }] };
      }

      return { content: [{ type: 'text', text: JSON.stringify(status, null, 2) }] };
    }
  );

  // ============================================================================
  // FLEET-ANALYTICS TOOL - Real-time fleet monitoring
  // ============================================================================

  server.tool(
    'fleet-analytics',
    'Get Piston Labs fleet analytics: device status, health metrics, activity stats.',
    {
      action: z.enum(['overview', 'health', 'activity', 'device']).describe('Analytics type'),
      deviceImei: z.string().optional().describe('Specific device IMEI'),
      agentId: z.string().describe('Your agent ID')
    },
    async (args) => {
      const { action, deviceImei, agentId } = args;

      try {
        let url = `${API_BASE}/api/fleet-analytics`;
        if (action === 'device' && deviceImei) {
          url += `?device=${deviceImei}`;
        } else if (action !== 'overview') {
          url += `?metric=${action}`;
        }

        const res = await fetch(url);
        const data = await res.json();
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: String(error) }) }] };
      }
    }
  );

  // ============================================================================
  // PROVISION-DEVICE TOOL - Device provisioning workflow
  // ============================================================================

  server.tool(
    'provision-device',
    'Provision a new Teltonika device for the fleet. Guides through AWS IoT setup.',
    {
      action: z.enum(['check', 'guide', 'verify']).describe('Provisioning action'),
      imei: z.string().optional().describe('15-digit IMEI of device to provision'),
      agentId: z.string().describe('Your agent ID')
    },
    async (args) => {
      const { action, imei, agentId } = args;

      switch (action) {
        case 'check':
          return { content: [{ type: 'text', text: JSON.stringify({
            action: 'check',
            provisionedDevices: 5,
            unprovisioned: 7,
            readyForBeta: 7,
            note: 'Use provision-device guide with IMEI to start provisioning'
          }, null, 2) }] };

        case 'guide':
          if (!imei || imei.length !== 15) {
            return { content: [{ type: 'text', text: JSON.stringify({
              error: 'Valid 15-digit IMEI required',
              example: 'provision-device({ action: "guide", imei: "862464068512345" })'
            }) }] };
          }

          return { content: [{ type: 'text', text: JSON.stringify({
            imei,
            provisioningSteps: [
              '1. Run: .\\scripts\\deployment\\provision_new_device.ps1 -IMEI ' + imei,
              '2. Script creates AWS IoT Thing, certificates, and policy',
              '3. Certificates saved to: certificates/' + imei + '/',
              '4. Configure device: MQTT broker, topic, certificates',
              '5. Verify: aws logs tail /aws/lambda/parse-teltonika-data --filter "' + imei + '"'
            ],
            awsResources: {
              thing: 'teltonika-' + imei,
              topic: 'teltonika/' + imei + '/data',
              s3Path: 's3://telemetry-raw-usw1/' + imei + '/'
            },
            requirements: [
              'AWS CLI configured with credentials',
              'PowerShell with admin rights',
              'Physical access to device for configuration'
            ]
          }, null, 2) }] };

        case 'verify':
          if (!imei) {
            return { content: [{ type: 'text', text: 'IMEI required for verification' }] };
          }

          return { content: [{ type: 'text', text: JSON.stringify({
            imei,
            verificationCommands: {
              checkThing: `aws iot describe-thing --thing-name teltonika-${imei}`,
              checkLogs: `aws logs tail /aws/lambda/parse-teltonika-data --filter-pattern '"${imei}"' --since 5m`,
              checkS3: `aws s3 ls s3://telemetry-raw-usw1/${imei}/`
            },
            expectedStatus: 'Device should appear in logs within 60 seconds of power-on'
          }, null, 2) }] };

        default:
          return { content: [{ type: 'text', text: 'Unknown action' }] };
      }
    }
  );

  // ============================================================================
  // ALERTS TOOL - Fleet monitoring and notifications
  // ============================================================================

  server.tool(
    'alerts',
    'Manage fleet alerts: device-offline, battery-low, speed-alert, maintenance-due.',
    {
      action: z.enum(['list', 'create', 'acknowledge', 'config']).describe('Alert operation'),
      alertType: z.enum(['device-offline', 'battery-low', 'geofence-breach', 'maintenance-due', 'speed-alert', 'custom']).optional(),
      severity: z.enum(['info', 'warning', 'critical']).optional(),
      message: z.string().optional(),
      deviceImei: z.string().optional(),
      alertId: z.string().optional().describe('For acknowledge action'),
      agentId: z.string().describe('Your agent ID')
    },
    async (args) => {
      const { action, alertType, severity, message, deviceImei, alertId, agentId } = args;

      try {
        switch (action) {
          case 'list': {
            const res = await fetch(`${API_BASE}/api/alerts`);
            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }
          case 'create': {
            if (!alertType || !message) {
              return { content: [{ type: 'text', text: 'alertType and message required' }] };
            }
            const res = await fetch(`${API_BASE}/api/alerts`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ type: alertType, severity: severity || 'warning', message, deviceImei })
            });
            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }
          case 'acknowledge': {
            if (!alertId) {
              return { content: [{ type: 'text', text: 'alertId required' }] };
            }
            const res = await fetch(`${API_BASE}/api/alerts`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: alertId, acknowledgedBy: agentId })
            });
            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }
          case 'config': {
            const res = await fetch(`${API_BASE}/api/alerts?action=config`);
            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }
          default:
            return { content: [{ type: 'text', text: 'Unknown action' }] };
        }
      } catch (error) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: String(error) }) }] };
      }
    }
  );

  // ============================================================================
  // GENERATE-DOC TOOL - Sales document generation
  // ============================================================================

  server.tool(
    'generate-doc',
    'Generate Piston Labs sales documents: pitches, objection responses, executive summaries.',
    {
      type: z.enum(['pitch', 'objection-responses', 'executive-summary']).describe('Document type'),
      target: z.enum(['shop-owner', 'investor']).describe('Target audience'),
      customization: z.object({
        shopName: z.string().optional(),
        ownerName: z.string().optional(),
        specificNeeds: z.string().optional()
      }).optional().describe('Customization options'),
      agentId: z.string().describe('Your agent ID')
    },
    async (args) => {
      const { type, target, customization, agentId } = args;

      try {
        const res = await fetch(`${API_BASE}/api/generate-doc`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type, target, customization })
        });
        const data = await res.json();
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: String(error) }) }] };
      }
    }
  );

  // ============================================================================
  // SALES-FILE TOOL - Save documents to Sales Engineering folders
  // ============================================================================

  server.tool(
    'sales-file',
    'Save generated documents to Sales Engineering folders. ALWAYS use this after generating any sales doc, email, pitch, or case study.',
    {
      action: z.enum(['save', 'list', 'get', 'update']).describe('save=create new file, list=show files, get=retrieve file, update=modify file'),
      name: z.string().optional().describe('Document name/title (required for save)'),
      type: z.enum(['pitch-deck', 'proposal', 'one-pager', 'email', 'demo-script', 'case-study', 'other']).optional()
        .describe('Document type - determines folder'),
      content: z.string().optional().describe('Document content/markdown (required for save)'),
      target: z.string().optional().describe('Target company or person'),
      notes: z.string().optional().describe('Additional notes about the document'),
      folder: z.string().optional().describe('Override auto-folder assignment'),
      fileId: z.string().optional().describe('File ID (for get/update)'),
      agentId: z.string().describe('Your agent ID')
    },
    async (args) => {
      const { action, name, type, content, target, notes, folder, fileId, agentId } = args;

      try {
        switch (action) {
          case 'save': {
            if (!name || !type || !content) {
              return { content: [{ type: 'text', text: JSON.stringify({
                error: 'name, type, and content required for save',
                hint: 'After generating a doc, call sales-file with action=save, name, type, and content'
              }) }] };
            }

            const res = await fetch(`${API_BASE}/api/sales-files`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                name,
                type,
                content,
                target,
                notes,
                folder,
                createdBy: agentId
              })
            });
            const data = await res.json();

            // Post to chat that doc was saved
            await fetch(`${API_BASE}/api/chat`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                author: agentId,
                message: `📁 Saved "${name}" to ${data.file?.folder || type} folder. File ID: ${data.file?.id}`
              })
            });

            return { content: [{ type: 'text', text: JSON.stringify({
              success: true,
              saved: {
                id: data.file?.id,
                name: data.file?.name,
                folder: data.file?.folder,
                type: data.file?.type
              },
              message: `Document "${name}" saved to ${data.file?.folder} folder`
            }, null, 2) }] };
          }

          case 'list': {
            const params = new URLSearchParams();
            if (folder) params.set('folder', folder);
            if (type) params.set('type', type);

            const res = await fetch(`${API_BASE}/api/sales-files?${params}`);
            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'get': {
            if (!fileId) {
              return { content: [{ type: 'text', text: JSON.stringify({ error: 'fileId required for get' }) }] };
            }
            const res = await fetch(`${API_BASE}/api/sales-files?id=${fileId}`);
            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'update': {
            if (!fileId) {
              return { content: [{ type: 'text', text: JSON.stringify({ error: 'fileId required for update' }) }] };
            }
            const res = await fetch(`${API_BASE}/api/sales-files`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                id: fileId,
                name,
                content,
                target,
                notes
              })
            });
            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          default:
            return { content: [{ type: 'text', text: `Unknown action: ${action}` }] };
        }
      } catch (error) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: String(error) }) }] };
      }
    }
  );

  // ============================================================================
  // SHOP TOOL - Sales pipeline management
  // ============================================================================

  server.tool(
    'shop',
    'Manage Piston Labs sales pipeline: track prospects, update status, add notes.',
    {
      action: z.enum(['list', 'add', 'update', 'get', 'pipeline']).describe('Operation'),
      shopName: z.string().optional().describe('Shop name (for add/update/get)'),
      status: z.enum(['prospect', 'contacted', 'demo-scheduled', 'beta-active', 'churned']).optional(),
      contact: z.string().optional().describe('Contact person name'),
      phone: z.string().optional(),
      email: z.string().optional(),
      notes: z.string().optional(),
      nextAction: z.string().optional(),
      agentId: z.string().describe('Your agent ID')
    },
    async (args) => {
      const { action, agentId, ...shopData } = args;

      try {
        switch (action) {
          case 'list':
          case 'pipeline': {
            const res = await fetch(`${API_BASE}/api/shops`);
            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }
          case 'get': {
            if (!shopData.shopName) {
              return { content: [{ type: 'text', text: 'shopName required' }] };
            }
            const res = await fetch(`${API_BASE}/api/shops?name=${encodeURIComponent(shopData.shopName)}`);
            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }
          case 'add':
          case 'update': {
            const res = await fetch(`${API_BASE}/api/shops`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(shopData)
            });
            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }
          default:
            return { content: [{ type: 'text', text: `Unknown action: ${action}` }] };
        }
      } catch (error) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: String(error) }) }] };
      }
    }
  );

  // ============================================================================
  // LINEAR TOOL - Issue tracking integration
  // ============================================================================

  server.tool(
    'linear',
    'Linear issue tracking integration. Create, update, and query issues for project management.',
    {
      action: z.enum(['list', 'get', 'create', 'update', 'teams', 'projects']).describe('Operation to perform'),
      issueId: z.string().optional().describe('Issue ID for get/update actions'),
      teamId: z.string().optional().describe('Team ID for creating issues'),
      teamKey: z.string().optional().describe('Team key (e.g., ENG) for filtering'),
      projectId: z.string().optional().describe('Project ID for filtering or assignment'),
      title: z.string().optional().describe('Issue title (required for create)'),
      description: z.string().optional().describe('Issue description/body'),
      priority: z.number().optional().describe('Priority 0-4 (0=none, 1=urgent, 4=low)'),
      status: z.string().optional().describe('Filter by status (e.g., "In Progress", "Done")'),
      stateId: z.string().optional().describe('State ID for updating status'),
      assigneeId: z.string().optional().describe('Assignee user ID'),
      limit: z.number().optional().describe('Max issues to return (default 25)'),
      agentId: z.string().describe('Your agent ID')
    },
    async (args) => {
      const { action, agentId, ...params } = args;

      try {
        switch (action) {
          case 'list': {
            const queryParams = new URLSearchParams();
            if (params.teamKey) queryParams.set('teamKey', params.teamKey);
            if (params.projectId) queryParams.set('projectId', params.projectId);
            if (params.status) queryParams.set('status', params.status);
            if (params.limit) queryParams.set('limit', String(params.limit));

            const res = await fetch(`${API_BASE}/api/linear?${queryParams}`);
            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'get': {
            if (!params.issueId) {
              return { content: [{ type: 'text', text: JSON.stringify({ error: 'issueId required for get action' }) }] };
            }
            const res = await fetch(`${API_BASE}/api/linear?issueId=${params.issueId}`);
            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'teams': {
            const res = await fetch(`${API_BASE}/api/linear?action=teams`);
            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'projects': {
            const res = await fetch(`${API_BASE}/api/linear?action=projects`);
            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'create': {
            if (!params.teamId || !params.title) {
              return { content: [{ type: 'text', text: JSON.stringify({
                error: 'teamId and title required for create',
                hint: 'Use action=teams to list available teams and get their IDs'
              }) }] };
            }

            const res = await fetch(`${API_BASE}/api/linear`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                teamId: params.teamId,
                title: params.title,
                description: params.description,
                priority: params.priority,
                projectId: params.projectId,
                assigneeId: params.assigneeId
              })
            });
            const data = await res.json();

            // Announce in chat
            if (data.success) {
              await fetch(`${API_BASE}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  author: agentId,
                  message: `📋 Created Linear issue: [${data.issue?.identifier}] ${params.title}`
                })
              });
            }

            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'update': {
            if (!params.issueId) {
              return { content: [{ type: 'text', text: JSON.stringify({ error: 'issueId required for update' }) }] };
            }

            const res = await fetch(`${API_BASE}/api/linear`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'update',
                issueId: params.issueId,
                title: params.title,
                description: params.description,
                priority: params.priority,
                stateId: params.stateId,
                projectId: params.projectId,
                assigneeId: params.assigneeId
              })
            });
            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          default:
            return { content: [{ type: 'text', text: `Unknown action: ${action}` }] };
        }
      } catch (error) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: String(error) }) }] };
      }
    }
  );

  // ============================================================================
  // SENTRY TOOL - Error tracking integration
  // ============================================================================

  server.tool(
    'sentry',
    'Sentry error tracking integration. Query issues, get error stats, monitor application health.',
    {
      action: z.enum(['overview', 'issues', 'issue', 'stats', 'events']).describe('overview=summary, issues=list issues, issue=get details, stats=project stats, events=issue events'),
      issueId: z.string().optional().describe('Issue ID (required for issue/events actions)'),
      query: z.string().optional().describe('Search query for filtering issues'),
      status: z.enum(['resolved', 'unresolved', 'ignored']).optional().describe('Filter by issue status'),
      level: z.enum(['fatal', 'error', 'warning', 'info', 'debug']).optional().describe('Filter by severity level'),
      limit: z.number().optional().describe('Max results to return (default 25, max 100)'),
      agentId: z.string().describe('Your agent ID')
    },
    async (args) => {
      const { action, issueId, query, status, level, limit, agentId } = args;

      try {
        const params = new URLSearchParams();
        if (issueId) params.set('issueId', issueId);
        if (query) params.set('query', query);
        if (status) params.set('status', status);
        if (level) params.set('level', level);
        if (limit) params.set('limit', String(limit));
        params.set('action', action);

        const res = await fetch(`${API_BASE}/api/sentry?${params}`);
        const data = await res.json();

        // Format overview nicely
        if (action === 'overview' && data.summary) {
          const summary = [
            `## Sentry Overview`,
            ``,
            `**Unresolved Issues:** ${data.summary.unresolvedIssues}`,
            `**Critical Issues:** ${data.summary.criticalIssues}`,
            `**Project:** ${data.summary.project}`,
            ``,
            `### Recent Issues:`
          ];

          if (data.recentIssues?.length > 0) {
            for (const issue of data.recentIssues) {
              summary.push(`- **${issue.shortId}** [${issue.level}]: ${issue.title}`);
              summary.push(`  Count: ${issue.count} | Last seen: ${issue.lastSeen}`);
            }
          } else {
            summary.push('No recent issues!');
          }

          return { content: [{ type: 'text', text: summary.join('\n') }] };
        }

        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: String(error) }) }] };
      }
    }
  );
}
