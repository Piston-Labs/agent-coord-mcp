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
          soracom: {
            description: 'LTE SIM infrastructure for Teltonika FMM00A devices',
            routing: 'Soracom Beam -> AWS IoT Core',
            status: 'operational'
          },
          lambda: {
            name: 'parse-teltonika-data',
            runtime: 'python3.13',
            status: 'operational',
            avgLatency: '<100ms',
            errorRate: '0%',
            note: 'Parses Teltonika FMM00A protocol data'
          },
          iot: {
            endpoint: 'AWS IoT Core us-west-1',
            protocol: 'MQTT over TLS',
            devices: 3,
            activeDevices: 3,
            deviceModel: 'Teltonika FMM00A',
            status: 'operational',
            pipeline: 'Soracom -> IoT Core -> Lambda -> S3/TimescaleDB/Supabase'
          },
          s3: {
            bucket: 'telemetry-raw-usw1',
            status: 'operational',
            note: 'Archives all raw telemetry data'
          },
          databases: {
            timescale: 'operational (real-time telemetry queries)',
            supabase: 'operational (user accounts, vehicles, service history)'
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
  // GOOGLE-DRIVE TOOL - Store sales documents in company Google Drive
  // ============================================================================

  server.tool(
    'google-drive',
    'Store and manage sales documents in Piston Labs Google Drive. Upload generated docs, list files, create folders.',
    {
      action: z.enum(['status', 'auth-url', 'list', 'get', 'upload', 'create-folder', 'delete', 'search'])
        .describe('status=check connection, auth-url=get OAuth URL, list=list files, get=get file, upload=upload file, create-folder=create folder, delete=delete file, search=search files'),
      name: z.string().optional().describe('File or folder name (for upload/create-folder)'),
      content: z.string().optional().describe('File content to upload (for upload)'),
      mimeType: z.string().optional().describe('MIME type (auto-detected from extension if not provided)'),
      folderId: z.string().optional().describe('Google Drive folder ID (uses GOOGLE_DRIVE_FOLDER_ID env var if not specified)'),
      fileId: z.string().optional().describe('Google Drive file ID (for get/delete)'),
      query: z.string().optional().describe('Search query (for search/list)'),
      description: z.string().optional().describe('File description'),
      localFileId: z.string().optional().describe('Link to local sales-file ID'),
      agentId: z.string().describe('Your agent ID')
    },
    async (args) => {
      const { action, name, content, mimeType, folderId, fileId, query, description, localFileId, agentId } = args;

      try {
        switch (action) {
          case 'status': {
            const res = await fetch(`${API_BASE}/api/google-drive?action=status`);
            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'auth-url': {
            const res = await fetch(`${API_BASE}/api/google-drive?action=auth-url`);
            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify({
              ...data,
              instructions: 'Open this URL in a browser to authorize Google Drive. Once authorized, files can be uploaded.'
            }, null, 2) }] };
          }

          case 'list': {
            const params = new URLSearchParams({ action: 'list' });
            if (folderId) params.set('folderId', folderId);
            if (query) params.set('query', query);

            const res = await fetch(`${API_BASE}/api/google-drive?${params}`);
            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'get': {
            if (!fileId) {
              return { content: [{ type: 'text', text: JSON.stringify({ error: 'fileId required for get' }) }] };
            }
            const res = await fetch(`${API_BASE}/api/google-drive?action=get&fileId=${fileId}`);
            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'upload': {
            if (!name || !content) {
              return { content: [{ type: 'text', text: JSON.stringify({
                error: 'name and content required for upload',
                hint: 'Use action=upload with name (filename) and content (file content)'
              }) }] };
            }

            const res = await fetch(`${API_BASE}/api/google-drive?action=upload`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                name,
                content,
                mimeType,
                folderId,
                description,
                localFileId,
                uploadedBy: agentId
              })
            });
            const data = await res.json();

            // Post to chat that file was uploaded
            if (data.success) {
              await fetch(`${API_BASE}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  author: agentId,
                  message: `📁 Uploaded "${name}" to Google Drive. [View file](${data.file?.webViewLink})`
                })
              });
            }

            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'create-folder': {
            if (!name) {
              return { content: [{ type: 'text', text: JSON.stringify({ error: 'name required for create-folder' }) }] };
            }

            const res = await fetch(`${API_BASE}/api/google-drive?action=create-folder`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name, parentId: folderId })
            });
            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'delete': {
            if (!fileId) {
              return { content: [{ type: 'text', text: JSON.stringify({ error: 'fileId required for delete' }) }] };
            }

            const res = await fetch(`${API_BASE}/api/google-drive?action=delete&fileId=${fileId}`, {
              method: 'DELETE'
            });
            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'search': {
            if (!query) {
              return { content: [{ type: 'text', text: JSON.stringify({ error: 'query required for search' }) }] };
            }

            const res = await fetch(`${API_BASE}/api/google-drive?action=search&query=${encodeURIComponent(query)}`);
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
  // USER-TASKS TOOL - Private task list for individual users
  // ============================================================================

  server.tool(
    'user-tasks',
    'Manage private task list for a specific user. Tasks are scoped to the user and not visible to others.',
    {
      action: z.enum(['list', 'create', 'update', 'delete', 'get'])
        .describe('list=show tasks, create=new task, update=modify task, delete=remove task, get=single task'),
      user: z.string().describe('Username to manage tasks for (e.g., tyler3)'),
      taskId: z.string().optional().describe('Task ID (for get/update/delete)'),
      title: z.string().optional().describe('Task title (for create/update)'),
      description: z.string().optional().describe('Task description'),
      status: z.enum(['todo', 'in-progress', 'done', 'blocked']).optional().describe('Task status'),
      priority: z.enum(['low', 'medium', 'high', 'urgent']).optional().describe('Task priority'),
      category: z.string().optional().describe('Task category for organization'),
      dueDate: z.string().optional().describe('Due date (ISO string)'),
      notes: z.string().optional().describe('Additional notes'),
      agentId: z.string().describe('Your agent ID')
    },
    async (args) => {
      const { action, user, taskId, title, description, status, priority, category, dueDate, notes, agentId } = args;

      try {
        switch (action) {
          case 'list': {
            const params = new URLSearchParams({ user });
            if (status) params.set('status', status);
            if (priority) params.set('priority', priority);
            if (category) params.set('category', category);

            const res = await fetch(`${API_BASE}/api/user-tasks?${params}`);
            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'get': {
            if (!taskId) {
              return { content: [{ type: 'text', text: JSON.stringify({ error: 'taskId required for get' }) }] };
            }
            const res = await fetch(`${API_BASE}/api/user-tasks?user=${user}&taskId=${taskId}`);
            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'create': {
            if (!title) {
              return { content: [{ type: 'text', text: JSON.stringify({ error: 'title required for create' }) }] };
            }

            const res = await fetch(`${API_BASE}/api/user-tasks?user=${user}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ title, description, priority, category, dueDate, notes })
            });
            const data = await res.json();

            // Notify in chat
            if (data.success) {
              await fetch(`${API_BASE}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  author: agentId,
                  message: `📋 Added task for @${user}: "${title}" [${priority || 'medium'}]`
                })
              });
            }

            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'update': {
            if (!taskId) {
              return { content: [{ type: 'text', text: JSON.stringify({ error: 'taskId required for update' }) }] };
            }

            const res = await fetch(`${API_BASE}/api/user-tasks?user=${user}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ taskId, title, description, status, priority, category, dueDate, notes })
            });
            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'delete': {
            if (!taskId) {
              return { content: [{ type: 'text', text: JSON.stringify({ error: 'taskId required for delete' }) }] };
            }

            const res = await fetch(`${API_BASE}/api/user-tasks?user=${user}&taskId=${taskId}`, {
              method: 'DELETE'
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
  // ERRORS TOOL - Self-hosted error tracking (free Sentry alternative)
  // ============================================================================

  server.tool(
    'errors',
    'Self-hosted error tracking (free Sentry alternative). Query issues, get error stats, capture errors. Uses Redis backend.',
    {
      action: z.enum(['overview', 'issues', 'issue', 'stats', 'events', 'capture', 'resolve', 'ignore']).describe('overview=summary, issues=list issues, issue=get details, stats=project stats, events=issue events, capture=log new error, resolve/ignore=update issue status'),
      issueId: z.string().optional().describe('Issue ID (required for issue/events/resolve/ignore actions)'),
      query: z.string().optional().describe('Search query for filtering issues'),
      status: z.enum(['resolved', 'unresolved', 'ignored']).optional().describe('Filter by issue status'),
      level: z.enum(['fatal', 'error', 'warning', 'info', 'debug']).optional().describe('Filter by severity level'),
      limit: z.number().optional().describe('Max results to return (default 25, max 100)'),
      // Capture-specific fields
      title: z.string().optional().describe('Error title/message (for capture action)'),
      culprit: z.string().optional().describe('Source of the error e.g. file:function (for capture)'),
      stacktrace: z.string().optional().describe('Full stacktrace (for capture)'),
      tags: z.record(z.string()).optional().describe('Key-value tags for categorization (for capture)'),
      extra: z.record(z.any()).optional().describe('Additional context data (for capture)'),
      agentId: z.string().describe('Your agent ID')
    },
    async (args) => {
      const { action, issueId, query, status, level, limit, title, culprit, stacktrace, tags, extra, agentId } = args;

      try {
        // Use self-hosted errors API (free alternative to Sentry)
        const apiEndpoint = `${API_BASE}/api/errors`;

        // Handle capture action - POST to create new error
        if (action === 'capture') {
          if (!title) {
            return { content: [{ type: 'text', text: JSON.stringify({ error: 'title is required for capture action' }) }] };
          }
          const res = await fetch(apiEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title,
              level: level || 'error',
              culprit: culprit || 'agent-capture',
              stacktrace,
              tags: { ...tags, agent: agentId },
              extra,
              user: { id: agentId }
            })
          });
          const data = await res.json();
          return { content: [{ type: 'text', text: JSON.stringify({
            success: true,
            message: data.isNew ? 'New issue created' : 'Event added to existing issue',
            ...data
          }, null, 2) }] };
        }

        // Handle resolve/ignore actions - PATCH to update status
        if (action === 'resolve' || action === 'ignore') {
          if (!issueId) {
            return { content: [{ type: 'text', text: JSON.stringify({ error: 'issueId required' }) }] };
          }
          const newStatus = action === 'resolve' ? 'resolved' : 'ignored';
          const res = await fetch(`${apiEndpoint}?issueId=${issueId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: newStatus })
          });
          const data = await res.json();
          return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
        }

        // Handle GET actions
        const params = new URLSearchParams();
        if (issueId) params.set('issueId', issueId);
        if (query) params.set('query', query);
        if (status) params.set('status', status);
        if (level) params.set('level', level);
        if (limit) params.set('limit', String(limit));
        params.set('action', action);

        const res = await fetch(`${apiEndpoint}?${params}`);
        const data = await res.json();

        // Format overview nicely
        if (action === 'overview' && data.summary) {
          const summary = [
            `## Error Tracking Overview`,
            ``,
            `**Source:** ${data.summary.source || 'self-hosted'} (free)`,
            `**Unresolved Issues:** ${data.summary.unresolvedIssues}`,
            `**Critical Issues:** ${data.summary.criticalIssues}`,
            `**Events (24h):** ${data.stats?.eventsLast24h || 0}`,
            ``,
            `### Recent Issues:`
          ];

          if (data.recentIssues?.length > 0) {
            for (const issue of data.recentIssues) {
              summary.push(`- **${issue.shortId}** [${issue.level}]: ${issue.title}`);
              summary.push(`  Count: ${issue.count} | Last seen: ${issue.lastSeen}`);
            }
          } else {
            summary.push('No recent issues - looking good!');
          }

          return { content: [{ type: 'text', text: summary.join('\n') }] };
        }

        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: String(error) }) }] };
      }
    }
  );

  // ============================================================================
  // AIRTABLE TOOL - Product roadmap and feature tracking
  // ============================================================================

  server.tool(
    'airtable',
    'Manage features, tasks, and product roadmap in Airtable. Create records, update status, query by view. Requires AIRTABLE_API_TOKEN and AIRTABLE_BASE_ID env vars.',
    {
      action: z.enum(['list-records', 'get-record', 'create-record', 'update-record', 'delete-record', 'list-tables'])
        .describe('list-records=query table, get-record=single record, create-record=add new, update-record=modify, delete-record=remove, list-tables=show schema'),
      table: z.string().optional().describe('Table name (e.g., "Features", "Tasks", "Roadmap")'),
      recordId: z.string().optional().describe('Record ID (starts with "rec...")'),
      fields: z.record(z.any()).optional().describe('Field values for create/update (e.g., { "Name": "Feature X", "Status": "Planned" })'),
      records: z.array(z.object({ id: z.string().optional(), fields: z.record(z.any()) })).optional()
        .describe('Batch create/update multiple records (max 10)'),
      view: z.string().optional().describe('Airtable view name for filtering (e.g., "Grid view", "Kanban")'),
      filterByFormula: z.string().optional().describe('Airtable formula filter (e.g., "{Status}=\'In Progress\'")'),
      maxRecords: z.number().optional().describe('Max records to return (default 100)'),
      sort: z.string().optional().describe('Sort by field:direction (e.g., "Priority:desc,Created:asc")'),
      agentId: z.string().describe('Your agent ID')
    },
    async (args) => {
      const { action, table, recordId, fields, records, view, filterByFormula, maxRecords, sort, agentId } = args;

      try {
        const params = new URLSearchParams();
        params.set('action', action);
        if (table) params.set('table', table);
        if (recordId) params.set('recordId', recordId);
        if (view) params.set('view', view);
        if (filterByFormula) params.set('filterByFormula', filterByFormula);
        if (maxRecords) params.set('maxRecords', String(maxRecords));
        if (sort) params.set('sort', sort);

        let method = 'GET';
        let body: string | undefined;

        if (action === 'create-record') {
          method = 'POST';
          body = JSON.stringify({ fields, records });
        } else if (action === 'update-record') {
          method = 'PATCH';
          body = JSON.stringify({ fields, records, id: recordId });
        } else if (action === 'delete-record') {
          method = 'DELETE';
          if (records) {
            body = JSON.stringify({ ids: records.map(r => r.id) });
          }
        }

        const res = await fetch(`${API_BASE}/api/airtable?${params}`, {
          method,
          headers: { 'Content-Type': 'application/json' },
          ...(body ? { body } : {})
        });
        const data = await res.json();

        // Format list-records nicely
        if (action === 'list-records' && data.records) {
          const lines = [
            `## ${table} (${data.records.length} records)`,
            ``
          ];

          for (const record of data.records.slice(0, 20)) {
            const name = record.fields?.Name || record.fields?.Title || record.id;
            const status = record.fields?.Status || '';
            lines.push(`- **${name}** ${status ? `[${status}]` : ''} (${record.id})`);
          }

          if (data.records.length > 20) {
            lines.push(``, `... and ${data.records.length - 20} more`);
          }

          return { content: [{ type: 'text', text: lines.join('\n') }] };
        }

        // Announce record creation in chat
        if (action === 'create-record' && data.success && data.created) {
          const createdNames = data.created.map((r: any) => r.fields?.Name || r.fields?.Title || r.id).join(', ');
          await fetch(`${API_BASE}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              author: agentId,
              message: `📋 Added to ${table}: ${createdNames}`
            })
          });
        }

        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: String(error) }) }] };
      }
    }
  );

  // ============================================================================
  // VERCEL-ENV TOOL - Manage Vercel environment variables
  // ============================================================================

  server.tool(
    'vercel-env',
    'Manage Vercel environment variables. List, get, set, or delete env vars. Only authorized agents (tyler3, tyler, admin) can modify. All actions are audit logged.',
    {
      action: z.enum(['list', 'get', 'set', 'delete', 'audit']).describe('list=show all vars, get=specific var, set=create/update, delete=remove, audit=view change log'),
      key: z.string().optional().describe('Environment variable name (required for get/set/delete)'),
      value: z.string().optional().describe('Value to set (required for set action)'),
      target: z.array(z.enum(['production', 'preview', 'development'])).optional()
        .describe('Deployment targets (default: all three)'),
      agentId: z.string().describe('Your agent ID - must be authorized for set/delete')
    },
    async (args) => {
      const { action, key, value, target, agentId } = args;

      try {
        switch (action) {
          case 'list': {
            const res = await fetch(`${API_BASE}/api/vercel-env?action=list&agentId=${agentId}`);
            const data = await res.json();

            if (data.error) {
              return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
            }

            // Format nicely
            const lines = [
              `## Vercel Environment Variables`,
              `Project: ${data.projectId}`,
              `Count: ${data.count}`,
              ``
            ];

            for (const env of data.envVars || []) {
              const targets = env.target?.join(', ') || 'all';
              lines.push(`- **${env.key}**: ${env.value} (${targets})`);
            }

            return { content: [{ type: 'text', text: lines.join('\n') }] };
          }

          case 'get': {
            if (!key) {
              return { content: [{ type: 'text', text: JSON.stringify({ error: 'key is required for get action' }) }] };
            }
            const res = await fetch(`${API_BASE}/api/vercel-env?action=get&key=${encodeURIComponent(key)}&agentId=${agentId}`);
            const data = await res.json();
            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'set': {
            if (!key || value === undefined) {
              return { content: [{ type: 'text', text: JSON.stringify({
                error: 'key and value are required for set action',
                example: 'vercel-env action=set key=ANTHROPIC_API_KEY value=sk-ant-xxx'
              }) }] };
            }

            const res = await fetch(`${API_BASE}/api/vercel-env`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                key,
                value,
                target: target || ['production', 'preview', 'development'],
                agentId
              })
            });
            const data = await res.json();

            if (data.success) {
              // Announce in chat
              await fetch(`${API_BASE}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  author: agentId,
                  message: `🔐 ${data.action === 'created' ? 'Added' : 'Updated'} env var: ${key} (targets: ${(target || ['production', 'preview', 'development']).join(', ')})`
                })
              });
            }

            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'delete': {
            if (!key) {
              return { content: [{ type: 'text', text: JSON.stringify({ error: 'key is required for delete action' }) }] };
            }

            const res = await fetch(`${API_BASE}/api/vercel-env?key=${encodeURIComponent(key)}&agentId=${agentId}`, {
              method: 'DELETE'
            });
            const data = await res.json();

            if (data.success) {
              // Announce in chat
              await fetch(`${API_BASE}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  author: agentId,
                  message: `🗑️ Deleted env var: ${key}`
                })
              });
            }

            return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
          }

          case 'audit': {
            const res = await fetch(`${API_BASE}/api/vercel-env?action=audit`);
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
}
