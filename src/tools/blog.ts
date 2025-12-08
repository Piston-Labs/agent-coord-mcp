/**
 * Blog Generation Tools
 *
 * MCP tools for blog generation with research library integration.
 * Tools: blog-session, blog-message, blog-draft, blog-search
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

const API_BASE = process.env.API_BASE || 'https://agent-coord-mcp.vercel.app';

export function registerBlogTools(server: McpServer) {
  // ============================================================================
  // BLOG-SESSION TOOL - Manage blog writing sessions
  // ============================================================================

  server.tool(
    'blog-session',
    'Create and manage blog generation sessions. Sessions track conversation history, research sources, and drafts for collaborative blog writing.',
    {
      action: z.enum(['create', 'get', 'list', 'delete']).describe('create=start new session, get=fetch session with messages, list=show all sessions, delete=remove session'),
      agentId: z.string().describe('Your agent ID'),
      sessionId: z.string().optional().describe('Session ID (for get/delete)'),
      topic: z.string().optional().describe('Blog topic (for create)'),
      title: z.string().optional().describe('Blog title (for create)'),
      status: z.enum(['active', 'draft-ready', 'published', 'archived']).optional().describe('Filter by status (for list)'),
    },
    async (args) => {
      const { action, agentId, sessionId, topic, title, status } = args;

      try {
        if (action === 'create') {
          if (!topic) {
            return { content: [{ type: 'text', text: JSON.stringify({ error: 'topic is required for create action' }) }] };
          }

          const res = await fetch(`${API_BASE}/api/blog?action=create-session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ topic, title, createdBy: agentId }),
          });

          const data = await res.json();
          return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
        }

        if (action === 'get') {
          if (!sessionId) {
            return { content: [{ type: 'text', text: JSON.stringify({ error: 'sessionId is required for get action' }) }] };
          }

          const res = await fetch(`${API_BASE}/api/blog?action=get-session&sessionId=${sessionId}`);
          const data = await res.json();
          return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
        }

        if (action === 'list') {
          let url = `${API_BASE}/api/blog?action=list-sessions`;
          if (status) url += `&status=${status}`;

          const res = await fetch(url);
          const data = await res.json();
          return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
        }

        if (action === 'delete') {
          if (!sessionId) {
            return { content: [{ type: 'text', text: JSON.stringify({ error: 'sessionId is required for delete action' }) }] };
          }

          const res = await fetch(`${API_BASE}/api/blog?action=delete-session&sessionId=${sessionId}`, {
            method: 'DELETE',
          });

          const data = await res.json();
          return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
        }

        return { content: [{ type: 'text', text: JSON.stringify({ error: 'Invalid action' }) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: String(error) }) }] };
      }
    }
  );

  // ============================================================================
  // BLOG-MESSAGE TOOL - Send messages in blog sessions
  // ============================================================================

  server.tool(
    'blog-message',
    'Send a message in a blog generation session. Used by agents to provide blog content, suggestions, and engage in the writing conversation.',
    {
      sessionId: z.string().describe('Blog session ID'),
      content: z.string().describe('Message content'),
      agentId: z.string().describe('Your agent ID'),
      role: z.enum(['user', 'assistant', 'system']).optional().describe('Message role (default: assistant for agents)'),
      researchCited: z.array(z.string()).optional().describe('IDs of research items cited in this message'),
      suggestedTopics: z.array(z.string()).optional().describe('Suggested related topics'),
      draftSection: z.string().optional().describe('If this is a draft section, specify which one'),
    },
    async (args) => {
      const { sessionId, content, agentId, role = 'assistant', researchCited, suggestedTopics, draftSection } = args;

      try {
        const metadata: any = {};
        if (researchCited) metadata.researchCited = researchCited;
        if (suggestedTopics) metadata.suggestedTopics = suggestedTopics;
        if (draftSection) metadata.draftSection = draftSection;

        const res = await fetch(`${API_BASE}/api/blog?action=send-message`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId,
            content,
            author: agentId,
            role,
            metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
          }),
        });

        const data = await res.json();
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: String(error) }) }] };
      }
    }
  );

  // ============================================================================
  // BLOG-DRAFT TOOL - Save and manage blog drafts
  // ============================================================================

  server.tool(
    'blog-draft',
    'Save or retrieve blog drafts. Drafts are structured blog content with metadata about word count, reading time, and research sources.',
    {
      action: z.enum(['save', 'get']).describe('save=create/update draft, get=retrieve draft'),
      agentId: z.string().describe('Your agent ID'),
      sessionId: z.string().optional().describe('Session ID (for save)'),
      draftId: z.string().optional().describe('Draft ID (for get)'),
      title: z.string().optional().describe('Blog title'),
      content: z.string().optional().describe('Full blog content in markdown'),
      sections: z.array(z.object({
        heading: z.string(),
        content: z.string(),
      })).optional().describe('Structured sections of the blog'),
    },
    async (args) => {
      const { action, agentId, sessionId, draftId, title, content, sections } = args;

      try {
        if (action === 'save') {
          if (!sessionId || !content) {
            return { content: [{ type: 'text', text: JSON.stringify({ error: 'sessionId and content are required for save action' }) }] };
          }

          const res = await fetch(`${API_BASE}/api/blog?action=save-draft`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sessionId,
              title,
              content,
              sections,
              generatedBy: agentId,
            }),
          });

          const data = await res.json();
          return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
        }

        if (action === 'get') {
          if (!draftId) {
            return { content: [{ type: 'text', text: JSON.stringify({ error: 'draftId is required for get action' }) }] };
          }

          const res = await fetch(`${API_BASE}/api/blog?action=get-draft&draftId=${draftId}`);
          const data = await res.json();
          return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
        }

        return { content: [{ type: 'text', text: JSON.stringify({ error: 'Invalid action' }) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: String(error) }) }] };
      }
    }
  );

  // ============================================================================
  // BLOG-SEARCH TOOL - Search research library for blog content
  // ============================================================================

  server.tool(
    'blog-search',
    'Search the research library and shared memory for content to use in blog posts. Returns relevant articles, research findings, and team knowledge.',
    {
      query: z.string().describe('Search query for finding relevant research'),
      sessionId: z.string().optional().describe('Blog session ID (if provided, sources will be linked to session)'),
      limit: z.number().optional().describe('Max results to return (default: 10)'),
      agentId: z.string().describe('Your agent ID'),
    },
    async (args) => {
      const { query, sessionId, limit = 10, agentId } = args;

      try {
        let url = `${API_BASE}/api/blog?action=search-research&query=${encodeURIComponent(query)}&limit=${limit}`;
        if (sessionId) url += `&sessionId=${sessionId}`;

        const res = await fetch(url);
        const data = await res.json();
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: String(error) }) }] };
      }
    }
  );

  // ============================================================================
  // BLOG-AGENT-PROMPT TOOL - Get agent prompt for blog writing
  // ============================================================================

  server.tool(
    'blog-agent-prompt',
    'Get a system prompt for spawning a Claude agent to handle blog generation. Returns a detailed prompt with role, context, and instructions.',
    {
      sessionId: z.string().optional().describe('Existing session ID to continue'),
      topic: z.string().optional().describe('Blog topic for new session'),
      researchContext: z.string().optional().describe('Pre-loaded research context to include'),
      agentId: z.string().describe('Your agent ID'),
    },
    async (args) => {
      const { sessionId, topic, researchContext, agentId } = args;

      try {
        let url = `${API_BASE}/api/blog?action=get-agent-prompt`;
        if (sessionId) url += `&sessionId=${sessionId}`;
        if (topic) url += `&topic=${encodeURIComponent(topic)}`;
        if (researchContext) url += `&researchContext=${encodeURIComponent(researchContext)}`;

        const res = await fetch(url);
        const data = await res.json();
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: String(error) }) }] };
      }
    }
  );
}
