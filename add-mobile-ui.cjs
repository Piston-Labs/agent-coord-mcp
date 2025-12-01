const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'web', 'index.html');
let content = fs.readFileSync(filePath, 'utf8');

// 1. Add mobile navigation CSS styles before the closing </style> tag
const mobileNavCSS = `
    /* Mobile Bottom Navigation - Professional Mobile Experience */
    .mobile-nav {
      display: none;
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      height: 64px;
      background: var(--bg-secondary);
      border-top: 1px solid var(--border);
      z-index: 1000;
      padding-bottom: env(safe-area-inset-bottom, 0);
    }

    .mobile-nav-inner {
      display: flex;
      height: 100%;
      max-width: 500px;
      margin: 0 auto;
    }

    .mobile-nav-item {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 4px;
      background: transparent;
      border: none;
      color: var(--text-secondary);
      font-size: 10px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s ease;
      padding: 8px 4px;
      position: relative;
    }

    .mobile-nav-item:active {
      background: var(--bg-tertiary);
    }

    .mobile-nav-item.active {
      color: var(--accent);
    }

    .mobile-nav-item.active::before {
      content: '';
      position: absolute;
      top: 0;
      left: 50%;
      transform: translateX(-50%);
      width: 32px;
      height: 3px;
      background: var(--accent);
      border-radius: 0 0 3px 3px;
    }

    .mobile-nav-icon {
      font-size: 22px;
      line-height: 1;
    }

    .mobile-nav-badge {
      position: absolute;
      top: 6px;
      right: calc(50% - 18px);
      background: var(--danger);
      color: white;
      font-size: 9px;
      font-weight: 700;
      min-width: 16px;
      height: 16px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0 4px;
    }

    /* Mobile panel visibility */
    @media (max-width: 1024px) {
      .mobile-nav {
        display: block;
      }

      body {
        padding-bottom: calc(64px + env(safe-area-inset-bottom, 0));
      }

      main {
        display: block !important;
        height: calc(100vh - 53px - 64px - env(safe-area-inset-bottom, 0)) !important;
        overflow: hidden;
      }

      .panel {
        display: none !important;
        height: 100% !important;
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
      }

      .panel.mobile-active {
        display: flex !important;
      }

      /* Header adjustments for mobile */
      header {
        padding: 8px 12px;
      }

      .logo {
        font-size: 14px;
        gap: 6px;
      }

      .logo svg {
        width: 22px;
        height: 22px;
      }

      .status-bar {
        gap: 8px;
        font-size: 11px;
      }

      .status-item:not(:first-child) {
        display: none;
      }

      /* Chat input optimization for mobile */
      .chat-input {
        padding: 10px 12px;
        gap: 8px;
      }

      .chat-input input[type="text"] {
        padding: 12px 14px;
        font-size: 16px; /* Prevents iOS zoom */
        border-radius: 20px;
      }

      .chat-input button {
        padding: 12px 16px;
        border-radius: 20px;
      }

      #usernameBtn, #imageBtn {
        width: 44px;
        height: 44px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0;
      }

      /* Context panel sections for mobile */
      .context-section {
        margin-bottom: 12px;
      }

      .context-title {
        font-size: 12px;
        padding: 0 4px;
        margin-bottom: 6px;
      }

      .context-item {
        padding: 12px;
        margin-bottom: 6px;
      }

      /* Agent cards for mobile */
      .agent-card {
        padding: 14px;
        margin-bottom: 8px;
      }

      .agent-avatar {
        width: 36px;
        height: 36px;
        font-size: 14px;
      }

      .agent-name {
        font-size: 14px;
      }

      .agent-task {
        font-size: 13px;
        white-space: normal;
        line-height: 1.4;
      }

      /* Messages optimization */
      .chat-messages {
        padding: 12px;
      }

      .message {
        max-width: 88%;
      }

      .message-avatar {
        width: 32px;
        height: 32px;
        font-size: 12px;
      }

      .message-content {
        padding: 10px 12px;
        border-radius: 16px;
      }

      .message-text {
        font-size: 15px;
        line-height: 1.45;
      }

      /* Roadmap adjustments for mobile */
      .roadmap-board {
        grid-template-columns: 1fr !important;
        gap: 16px;
        padding: 12px;
      }

      .roadmap-column {
        min-height: auto;
      }

      .roadmap-filters {
        flex-wrap: wrap;
        gap: 8px;
        padding: 10px 12px;
      }

      .roadmap-filters select {
        flex: 1;
        min-width: 120px;
      }

      .add-item-btn {
        width: 100%;
        margin-left: 0;
        margin-top: 4px;
      }

      /* Modal full-screen on mobile */
      .modal {
        width: 100%;
        height: 100%;
        max-height: 100vh;
        max-width: 100%;
        border-radius: 0;
        margin: 0;
      }

      .modal-overlay.active {
        align-items: flex-start;
      }

      /* Quick actions grid for mobile */
      .context-section > div[style*="grid-template-columns: 1fr 1fr"] {
        gap: 8px !important;
      }

      .context-section button.context-item {
        min-height: 60px;
        padding: 12px 8px !important;
      }
    }

    /* Extra small screens */
    @media (max-width: 380px) {
      .logo span:not(:first-child) {
        display: none;
      }

      .mobile-nav-item {
        font-size: 9px;
      }

      .mobile-nav-icon {
        font-size: 20px;
      }
    }

`;

content = content.replace('  </style>', mobileNavCSS + '  </style>');

// 2. Add the mobile navigation HTML before closing </body>
const mobileNavHTML = `
  <!-- Mobile Bottom Navigation -->
  <nav class="mobile-nav" id="mobileNav">
    <div class="mobile-nav-inner">
      <button class="mobile-nav-item" data-panel="team" onclick="switchMobilePanel('team')">
        <span class="mobile-nav-icon">👥</span>
        <span>Team</span>
        <span class="mobile-nav-badge" id="teamBadge" style="display: none;">0</span>
      </button>
      <button class="mobile-nav-item active" data-panel="chat" onclick="switchMobilePanel('chat')">
        <span class="mobile-nav-icon">💬</span>
        <span>Chat</span>
        <span class="mobile-nav-badge" id="chatBadge" style="display: none;">0</span>
      </button>
      <button class="mobile-nav-item" data-panel="context" onclick="switchMobilePanel('context')">
        <span class="mobile-nav-icon">📊</span>
        <span>Context</span>
      </button>
    </div>
  </nav>

`;

content = content.replace('</body>', mobileNavHTML + '</body>');

// 3. Add mobile panel switching JavaScript before </script>
const mobileJS = `

    // Mobile Navigation Functions
    let currentMobilePanel = 'chat';
    let unreadMessages = 0;

    function switchMobilePanel(panelName) {
      const panels = document.querySelectorAll('main > .panel');
      const navItems = document.querySelectorAll('.mobile-nav-item');

      // Map panel names to indices
      const panelMap = { 'team': 0, 'chat': 1, 'context': 2 };
      const panelIndex = panelMap[panelName];

      // Remove active class from all panels and nav items
      panels.forEach(p => p.classList.remove('mobile-active'));
      navItems.forEach(n => n.classList.remove('active'));

      // Add active class to selected panel and nav item
      if (panels[panelIndex]) {
        panels[panelIndex].classList.add('mobile-active');
      }

      const navItem = document.querySelector(\`.mobile-nav-item[data-panel="\${panelName}"]\`);
      if (navItem) {
        navItem.classList.add('active');
      }

      currentMobilePanel = panelName;

      // Clear badge when viewing chat
      if (panelName === 'chat') {
        unreadMessages = 0;
        updateChatBadge();
      }
    }

    function updateChatBadge() {
      const badge = document.getElementById('chatBadge');
      if (badge) {
        if (unreadMessages > 0 && currentMobilePanel !== 'chat') {
          badge.textContent = unreadMessages > 99 ? '99+' : unreadMessages;
          badge.style.display = 'flex';
        } else {
          badge.style.display = 'none';
        }
      }
    }

    function updateTeamBadge(onlineCount) {
      const badge = document.getElementById('teamBadge');
      if (badge) {
        if (onlineCount > 0) {
          badge.textContent = onlineCount;
          badge.style.display = 'flex';
          badge.style.background = 'var(--success)';
        } else {
          badge.style.display = 'none';
        }
      }
    }

    // Initialize mobile panel on page load
    function initMobileNav() {
      // Check if mobile view
      if (window.innerWidth <= 1024) {
        switchMobilePanel('chat');
      }
    }

    // Hook into existing message polling to track unread
    const originalRenderMessages = typeof renderMessages === 'function' ? renderMessages : null;

    // Intercept new messages for badge updates
    function trackNewMessages(newMessageCount) {
      if (currentMobilePanel !== 'chat' && newMessageCount > 0) {
        unreadMessages += newMessageCount;
        updateChatBadge();
      }
    }

    // Initialize on load
    window.addEventListener('load', initMobileNav);
    window.addEventListener('resize', () => {
      if (window.innerWidth <= 1024) {
        // Ensure a panel is active on mobile
        if (!document.querySelector('.panel.mobile-active')) {
          switchMobilePanel(currentMobilePanel || 'chat');
        }
      }
    });

`;

content = content.replace('  </script>', mobileJS + '  </script>');

// 4. Update the fetchAgents function to update team badge
const oldFetchAgentsEnd = `document.getElementById('agentCount').textContent = agents.length;`;
const newFetchAgentsEnd = `document.getElementById('agentCount').textContent = agents.length;
      // Update mobile team badge
      if (typeof updateTeamBadge === 'function') {
        updateTeamBadge(agents.length);
      }`;

content = content.replace(oldFetchAgentsEnd, newFetchAgentsEnd);

// 5. Update renderMessages to track new messages for mobile badge
const oldRenderEnd = `document.getElementById('messageCount').textContent = messages.length + ' messages';`;
const newRenderEnd = `document.getElementById('messageCount').textContent = messages.length + ' messages';

      // Track new messages for mobile badge
      if (typeof trackNewMessages === 'function' && window.lastMessageCount !== undefined) {
        const newCount = messages.length - window.lastMessageCount;
        if (newCount > 0) {
          trackNewMessages(newCount);
        }
      }
      window.lastMessageCount = messages.length;`;

content = content.replace(oldRenderEnd, newRenderEnd);

fs.writeFileSync(filePath, content, 'utf8');
console.log('Mobile UI improvements added successfully!');
console.log('- Added bottom navigation bar with Team, Chat, Context tabs');
console.log('- Added panel switching functionality');
console.log('- Added unread message badge for chat');
console.log('- Added online agents badge for team');
console.log('- Optimized all panels for mobile viewing');
console.log('- Added touch-friendly button sizes');
