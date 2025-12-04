import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * UI Map API - Navigation map for agents to understand index.html structure
 * without loading the entire 190k+ token file.
 *
 * GET /api/ui-map - Get the full UI structure map
 * GET /api/ui-map?section=css - Get just CSS section info
 * GET /api/ui-map?section=html - Get just HTML structure
 * GET /api/ui-map?section=js - Get just JavaScript sections
 * GET /api/ui-map?component=xp - Get info about a specific component
 *
 * This map is manually maintained and should be updated when major UI changes occur.
 * Last updated: 2025-12-04
 */

interface Section {
  name: string;
  description: string;
  lineRange: string;
  estimatedTokens: number;
  subsections?: Section[];
}

interface Component {
  name: string;
  description: string;
  cssLines: string;
  htmlLines: string;
  jsLines: string;
  relatedFunctions: string[];
  apiEndpoints: string[];
}

const UI_MAP = {
  lastUpdated: '2025-12-04',
  totalLines: 20500,
  estimatedTokens: 191000,

  overview: {
    description: 'Piston Labs Agent Coordination Hub - Single-page dashboard with multiple tabs',
    mainSections: [
      'CSS Styles (lines 7-8700)',
      'HTML Structure (lines 8700-10900)',
      'JavaScript Logic (lines 10900-18000)',
      'Mobile Styles (lines 18000-18500)',
      'Bottom Navigation (lines 18500-20500)'
    ]
  },

  css: {
    description: 'All CSS styles for the dashboard',
    lineRange: '7-8700',
    estimatedTokens: 54000,
    sections: [
      { name: 'CSS Variables', lineRange: '8-21', description: 'Color theme variables (--bg-primary, --accent, etc.)' },
      { name: 'Base Styles', lineRange: '22-100', description: 'Body, header, layout grid' },
      { name: 'Agent XP Styles', lineRange: '181-323', description: '.xp-section, .xp-item, .xp-bar styles' },
      { name: 'Research Library Styles', lineRange: '325-466', description: '.research-view, .research-card, .research-grid' },
      { name: 'Kudos Styles', lineRange: '468-600', description: '.kudos-section, .kudos-item leaderboard' },
      { name: 'Chat Styles', lineRange: '600-900', description: '.chat-messages, .chat-input, message bubbles' },
      { name: 'Agent Hover Cards', lineRange: '900-1100', description: '.agent-hover-card, hover card positioning' },
      { name: 'Roadmap Styles', lineRange: '1100-2000', description: 'Kanban board, roadmap cards, drag-drop' },
      { name: 'Metrics Styles', lineRange: '2000-2800', description: 'Metrics grid, cards, sparklines' },
      { name: 'Telemetry Styles', lineRange: '2800-3500', description: 'Fleet dashboard, device cards' },
      { name: 'CRM Styles', lineRange: '3500-4200', description: 'CRM table, shop cards' },
      { name: 'Sales Eng Styles', lineRange: '4200-5000', description: 'Sales dashboard, documents' },
      { name: 'Training Styles', lineRange: '7864-8000', description: 'Training hub, quiz styles' },
      { name: 'Mobile Responsive', lineRange: '5100-5500', description: '@media queries for mobile' },
      { name: 'Tab Styles', lineRange: '8600-8700', description: '.tab-btn, .tab-content' }
    ]
  },

  html: {
    description: 'HTML structure - header, sidebar, main content area with tabs',
    lineRange: '8700-10900',
    estimatedTokens: 25000,
    sections: [
      { name: 'Header', lineRange: '9000-9030', description: 'Logo, status bar, connection indicator' },
      { name: 'Left Sidebar', lineRange: '9030-9380', description: 'Agent list, Team Tools, XP Section, Kudos' },
      { name: 'Tab Buttons', lineRange: '9383-9396', description: 'Tab navigation (Chat, Roadmap, Telemetry, etc.)' },
      { name: 'Chat View', lineRange: '9398-9480', description: 'Chat messages area, input field' },
      { name: 'Roadmap View', lineRange: '9480-9700', description: 'Kanban board, filters, cycle selector' },
      { name: 'Metrics View', lineRange: '9700-9950', description: 'Metrics grid cards' },
      { name: 'Telemetry View', lineRange: '9950-10100', description: 'Fleet dashboard, device list' },
      { name: 'CRM View', lineRange: '10100-10200', description: 'Shop CRM table' },
      { name: 'Sales Eng View', lineRange: '10200-10350', description: 'Sales documents panel' },
      { name: 'Training View', lineRange: '10350-10490', description: 'Training modules, chat coach' },
      { name: 'Research View', lineRange: '10492-10506', description: 'Research library grid' },
      { name: 'CEO Portal View', lineRange: '10508-10850', description: 'CEO-only dashboard (hidden by default)' },
      { name: 'Right Sidebar', lineRange: '10850-10900', description: 'Threads panel' }
    ]
  },

  javascript: {
    description: 'All JavaScript logic for the dashboard',
    lineRange: '10900-18000',
    estimatedTokens: 80000,
    sections: [
      { name: 'Constants & State', lineRange: '10900-11000', description: 'API_BASE, caches, state variables' },
      { name: 'Initialization', lineRange: '11000-11200', description: 'DOMContentLoaded, initial fetches' },
      { name: 'Agent Management', lineRange: '11200-11500', description: 'fetchAgents, renderAgents, status updates' },
      { name: 'Chat Functions', lineRange: '11500-11800', description: 'sendMessage, fetchMessages, renderChat' },
      { name: 'Agent Hover Cards', lineRange: '11800-11920', description: 'showAgentHoverCard, hover positioning' },
      { name: 'Team Capabilities', lineRange: '11890-11924', description: 'fetchTeamCapabilities, toggleCapabilities' },
      { name: 'Agent XP Functions', lineRange: '11925-11986', description: 'toggleXP, fetchXPLeaderboard' },
      { name: 'Research Functions', lineRange: '11988-12055', description: 'fetchResearchLibrary, filterResearch, renderResearchGrid' },
      { name: 'Kudos Functions', lineRange: '12057-12200', description: 'toggleKudos, fetchKudosLeaderboard, giveKudos' },
      { name: 'Roadmap Functions', lineRange: '12200-12800', description: 'fetchRoadmap, drag-drop, kanban logic' },
      { name: 'Metrics Functions', lineRange: '12800-13100', description: 'fetchMetrics, sparklines, charts' },
      { name: 'Telemetry Functions', lineRange: '13100-13300', description: 'fetchTelemetry, device polling' },
      { name: 'Tab Switching', lineRange: '13307-13370', description: 'switchTab function, tab initialization' },
      { name: 'CEO Portal Functions', lineRange: '13370-14200', description: 'CEO contacts, ideas, notes, tasks' },
      { name: 'CRM Functions', lineRange: '14200-14800', description: 'initCrm, shop management' },
      { name: 'Sales Eng Functions', lineRange: '14800-15400', description: 'initSalesEng, document generation' },
      { name: 'Training Functions', lineRange: '15400-16000', description: 'initTraining, quiz logic, coach chat' },
      { name: 'Keyboard Shortcuts', lineRange: '16000-16200', description: 'Cmd+K, ?, J/K navigation, 1-4 status' },
      { name: 'Utility Functions', lineRange: '16200-17000', description: 'formatDate, debounce, helpers' },
      { name: 'Polling & Updates', lineRange: '17000-17600', description: 'Auto-refresh, WebSocket fallback' }
    ]
  },

  components: {
    'agent-list': {
      name: 'Agent List (Sidebar)',
      description: 'Shows online/offline agents with status indicators',
      cssLines: '100-180',
      htmlLines: '9030-9100',
      jsLines: '11200-11500',
      relatedFunctions: ['fetchAgents', 'renderAgents', 'updateAgentStatus'],
      apiEndpoints: ['/api/agent-status', '/api/agents']
    },
    'xp-stats': {
      name: 'Agent XP & Stats',
      description: 'Collapsible sidebar section showing agent XP leaderboard with levels and achievements',
      cssLines: '181-323',
      htmlLines: '9342-9360',
      jsLines: '11925-11986',
      relatedFunctions: ['toggleXP', 'fetchXPLeaderboard'],
      apiEndpoints: ['/api/agent-xp']
    },
    'kudos': {
      name: 'Kudos Leaderboard',
      description: 'Peer recognition system with give kudos modal',
      cssLines: '468-600',
      htmlLines: '9361-9378',
      jsLines: '12057-12200',
      relatedFunctions: ['toggleKudos', 'fetchKudosLeaderboard', 'showGiveKudosModal', 'submitKudos'],
      apiEndpoints: ['/api/kudos']
    },
    'chat': {
      name: 'Group Chat',
      description: 'Team chat with @mentions, image upload, agent hover cards',
      cssLines: '600-900',
      htmlLines: '9398-9480',
      jsLines: '11500-11800',
      relatedFunctions: ['sendMessage', 'fetchMessages', 'renderChatMessage', 'handleImageUpload'],
      apiEndpoints: ['/api/chat']
    },
    'hover-cards': {
      name: 'Agent Hover Cards',
      description: 'Popup cards showing agent MCP tools, capabilities, status on hover',
      cssLines: '900-1100',
      htmlLines: 'Dynamically generated',
      jsLines: '11800-11920',
      relatedFunctions: ['showAgentHoverCard', 'hideAgentHoverCard', 'toggleAgentHoverCard'],
      apiEndpoints: ['/api/agent-profiles']
    },
    'research': {
      name: 'Research Library',
      description: 'Grid of technical articles discovered by agents with category filtering. Categories: infrastructure, multi-agent, ux-patterns, foundational-ml (20 seminal AI papers 1986-2022)',
      cssLines: '325-466',
      htmlLines: '10492-10506',
      jsLines: '11988-12055',
      relatedFunctions: ['fetchResearchLibrary', 'filterResearch', 'renderResearchGrid'],
      apiEndpoints: ['/api/research-library']
    },
    'roadmap': {
      name: 'Roadmap Kanban',
      description: 'Drag-drop kanban board with cycles, dependencies, assignments',
      cssLines: '1100-2000',
      htmlLines: '9480-9700',
      jsLines: '12200-12800',
      relatedFunctions: ['fetchRoadmap', 'initDragDrop', 'moveItem', 'renderKanban'],
      apiEndpoints: ['/api/roadmap']
    },
    'metrics': {
      name: 'Metrics Dashboard',
      description: 'System metrics with sparklines, agent activity, coordination stats',
      cssLines: '2000-2800',
      htmlLines: '9700-9950',
      jsLines: '12800-13100',
      relatedFunctions: ['fetchMetrics', 'renderSparkline', 'setMetricsPeriod'],
      apiEndpoints: ['/api/metrics', '/api/digest']
    },
    'telemetry': {
      name: 'Fleet Telemetry',
      description: 'GPS device dashboard with real-time status, battery, location',
      cssLines: '2800-3500',
      htmlLines: '9950-10100',
      jsLines: '13100-13300',
      relatedFunctions: ['fetchTelemetry', 'renderDeviceCard', 'updateTelemetryPollRate'],
      apiEndpoints: ['/api/telemetry', '/api/device']
    },
    'training': {
      name: 'Training Hub',
      description: 'Sales training modules with AI coach chat, quizzes, progress tracking',
      cssLines: '7864-8000',
      htmlLines: '10350-10490',
      jsLines: '15400-16000',
      relatedFunctions: ['initTraining', 'selectModule', 'submitQuiz', 'sendTrainingMessage'],
      apiEndpoints: ['/api/training']
    },
    'ceo-portal': {
      name: 'CEO Portal',
      description: 'Private CEO dashboard with contacts, ideas, notes, tasks (hidden by default)',
      cssLines: '5000-5100',
      htmlLines: '10508-10850',
      jsLines: '13370-14200',
      relatedFunctions: ['initCeoPortal', 'fetchCeoContacts', 'saveCeoIdea', 'addCeoNote'],
      apiEndpoints: ['/api/ceo-contacts', '/api/ceo-ideas', '/api/ceo-notes', '/api/user-tasks']
    }
  },

  tips: [
    'Use file-read-smart with line ranges to read specific sections',
    'CSS changes: focus on lines 7-8700',
    'To modify a component, check the components section for exact line numbers',
    'New tabs require: CSS styles, HTML in tab-content, JS functions, switchTab case',
    'Always check if similar styling exists before adding new CSS',
    'Tab buttons are at line 9383-9396',
    'The switchTab function is at line 13307'
  ]
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { section, component } = req.query;

  // Return specific section
  if (section && typeof section === 'string') {
    const sectionData = UI_MAP[section as keyof typeof UI_MAP];
    if (!sectionData) {
      return res.status(404).json({
        error: `Section '${section}' not found`,
        availableSections: ['css', 'html', 'javascript', 'components', 'overview', 'tips']
      });
    }
    return res.status(200).json({
      section,
      lastUpdated: UI_MAP.lastUpdated,
      data: sectionData
    });
  }

  // Return specific component
  if (component && typeof component === 'string') {
    const componentData = UI_MAP.components[component as keyof typeof UI_MAP.components];
    if (!componentData) {
      return res.status(404).json({
        error: `Component '${component}' not found`,
        availableComponents: Object.keys(UI_MAP.components)
      });
    }
    return res.status(200).json({
      component,
      lastUpdated: UI_MAP.lastUpdated,
      data: componentData
    });
  }

  // Return full map
  return res.status(200).json(UI_MAP);
}
