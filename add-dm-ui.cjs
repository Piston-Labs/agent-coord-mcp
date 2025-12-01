const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'web', 'index.html');
let content = fs.readFileSync(filePath, 'utf8');

// 1. Add DM CSS styles before </style>
const dmCSS = `
    /* Direct Messaging Styles */
    .dm-badge {
      position: relative;
      cursor: pointer;
      padding: 8px 12px;
      background: var(--bg-tertiary);
      border-radius: 6px;
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;
      border: none;
      color: var(--text-primary);
    }

    .dm-badge:hover {
      background: var(--bg-secondary);
    }

    .dm-badge-count {
      background: var(--danger);
      color: white;
      font-size: 10px;
      font-weight: 700;
      min-width: 18px;
      height: 18px;
      border-radius: 9px;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0 5px;
    }

    .dm-panel {
      position: fixed;
      top: 53px;
      right: 0;
      width: 360px;
      max-width: 100vw;
      height: calc(100vh - 53px);
      background: var(--bg-primary);
      border-left: 1px solid var(--border);
      z-index: 900;
      display: none;
      flex-direction: column;
    }

    .dm-panel.active {
      display: flex;
    }

    .dm-panel-header {
      padding: 16px;
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .dm-panel-header h3 {
      margin: 0;
      font-size: 16px;
    }

    .dm-close-btn {
      background: none;
      border: none;
      color: var(--text-secondary);
      font-size: 20px;
      cursor: pointer;
      padding: 4px 8px;
    }

    .dm-close-btn:hover {
      color: var(--text-primary);
    }

    .dm-conversations {
      flex: 1;
      overflow-y: auto;
      padding: 8px;
    }

    .dm-convo-item {
      padding: 12px;
      border-radius: 8px;
      cursor: pointer;
      margin-bottom: 4px;
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      transition: all 0.15s;
    }

    .dm-convo-item:hover {
      border-color: var(--accent);
    }

    .dm-convo-item.unread {
      border-left: 3px solid var(--accent);
    }

    .dm-convo-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 4px;
    }

    .dm-convo-name {
      font-weight: 600;
      font-size: 14px;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .dm-convo-time {
      font-size: 11px;
      color: var(--text-secondary);
    }

    .dm-convo-preview {
      font-size: 12px;
      color: var(--text-secondary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .dm-unread-badge {
      background: var(--accent);
      color: white;
      font-size: 10px;
      font-weight: 700;
      min-width: 16px;
      height: 16px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0 4px;
    }

    .dm-chat-view {
      display: none;
      flex-direction: column;
      height: 100%;
    }

    .dm-chat-view.active {
      display: flex;
    }

    .dm-chat-header {
      padding: 12px 16px;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .dm-back-btn {
      background: none;
      border: none;
      color: var(--text-secondary);
      font-size: 18px;
      cursor: pointer;
      padding: 4px;
    }

    .dm-back-btn:hover {
      color: var(--text-primary);
    }

    .dm-chat-messages {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .dm-message {
      max-width: 80%;
      padding: 10px 14px;
      border-radius: 12px;
      font-size: 14px;
      line-height: 1.4;
    }

    .dm-message.sent {
      align-self: flex-end;
      background: var(--accent);
      color: white;
    }

    .dm-message.received {
      align-self: flex-start;
      background: var(--bg-secondary);
      border: 1px solid var(--border);
    }

    .dm-message-time {
      font-size: 10px;
      opacity: 0.7;
      margin-top: 4px;
    }

    .dm-message-attachment {
      margin-top: 8px;
    }

    .dm-message-attachment img {
      max-width: 200px;
      max-height: 150px;
      border-radius: 8px;
      cursor: pointer;
    }

    .dm-chat-input {
      padding: 12px;
      border-top: 1px solid var(--border);
      display: flex;
      gap: 8px;
      align-items: flex-end;
    }

    .dm-chat-input input {
      flex: 1;
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: 20px;
      padding: 10px 16px;
      color: var(--text-primary);
      font-size: 14px;
    }

    .dm-chat-input input:focus {
      border-color: var(--accent);
      outline: none;
    }

    .dm-chat-input button {
      background: var(--accent);
      color: white;
      border: none;
      border-radius: 50%;
      width: 40px;
      height: 40px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
    }

    .dm-attach-btn {
      background: var(--bg-tertiary) !important;
      color: var(--text-primary) !important;
    }

    .dm-new-chat-btn {
      width: 100%;
      padding: 12px;
      background: var(--accent);
      color: white;
      border: none;
      border-radius: 8px;
      font-weight: 600;
      cursor: pointer;
      margin: 8px 0;
    }

    .dm-new-chat-btn:hover {
      opacity: 0.9;
    }

    .dm-empty {
      text-align: center;
      padding: 40px 20px;
      color: var(--text-secondary);
    }

    .dm-empty-icon {
      font-size: 48px;
      margin-bottom: 12px;
    }

    /* New DM Modal */
    .dm-new-modal {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0,0,0,0.7);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 1100;
    }

    .dm-new-modal.active {
      display: flex;
    }

    .dm-new-modal-content {
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 24px;
      width: 90%;
      max-width: 400px;
    }

    .dm-user-list {
      max-height: 300px;
      overflow-y: auto;
      margin: 16px 0;
    }

    .dm-user-item {
      padding: 12px;
      border-radius: 8px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 4px;
    }

    .dm-user-item:hover {
      background: var(--bg-tertiary);
    }

    .dm-user-avatar {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 600;
    }

    .dm-user-avatar.agent {
      background: var(--accent);
    }

    .dm-user-avatar.human {
      background: var(--human-color);
    }

    @media (max-width: 768px) {
      .dm-panel {
        width: 100%;
        top: 0;
        height: 100vh;
        z-index: 1000;
      }
    }

`;

content = content.replace('  </style>', dmCSS + '  </style>');

// 2. Add DM button to header status bar
const oldStatusBar = `<div class="status-bar">`;
const newStatusBar = `<div class="status-bar">
      <button class="dm-badge" onclick="toggleDMPanel()" title="Direct Messages">
        📨 <span id="dmBadgeCount" class="dm-badge-count" style="display: none;">0</span>
      </button>`;

content = content.replace(oldStatusBar, newStatusBar);

// 3. Add DM panel HTML before </body>
const dmPanelHTML = `
  <!-- Direct Messages Panel -->
  <div class="dm-panel" id="dmPanel">
    <!-- Conversations List View -->
    <div id="dmConversationsList">
      <div class="dm-panel-header">
        <h3>📨 Direct Messages</h3>
        <button class="dm-close-btn" onclick="toggleDMPanel()">✕</button>
      </div>
      <div style="padding: 0 8px;">
        <button class="dm-new-chat-btn" onclick="showNewDMModal()">+ New Message</button>
      </div>
      <div class="dm-conversations" id="dmConversations">
        <div class="dm-empty">
          <div class="dm-empty-icon">💬</div>
          <div>No conversations yet</div>
          <div style="font-size: 12px; margin-top: 4px;">Start a direct message with someone</div>
        </div>
      </div>
    </div>

    <!-- Chat View -->
    <div class="dm-chat-view" id="dmChatView">
      <div class="dm-chat-header">
        <button class="dm-back-btn" onclick="closeDMChat()">←</button>
        <div>
          <div id="dmChatRecipient" style="font-weight: 600;"></div>
          <div id="dmChatRecipientType" style="font-size: 11px; color: var(--text-secondary);"></div>
        </div>
      </div>
      <div class="dm-chat-messages" id="dmChatMessages"></div>
      <div class="dm-chat-input">
        <input type="file" id="dmFileInput" accept="image/*,.pdf,.txt,.md,.json" style="display: none;" />
        <button class="dm-attach-btn" onclick="document.getElementById('dmFileInput').click()" title="Attach file">📎</button>
        <input type="text" id="dmMessageInput" placeholder="Type a message..." onkeypress="handleDMKeypress(event)" />
        <button onclick="sendDM()">→</button>
      </div>
    </div>
  </div>

  <!-- New DM Modal -->
  <div class="dm-new-modal" id="dmNewModal">
    <div class="dm-new-modal-content">
      <h3 style="margin: 0 0 16px 0;">Start a conversation</h3>
      <input type="text" id="dmSearchUser" placeholder="Search users..." style="width: 100%; padding: 10px; background: var(--bg-primary); border: 1px solid var(--border); border-radius: 6px; color: var(--text-primary);" oninput="filterDMUsers()" />
      <div class="dm-user-list" id="dmUserList"></div>
      <button style="width: 100%; padding: 10px; background: var(--bg-tertiary); border: 1px solid var(--border); border-radius: 6px; color: var(--text-primary); cursor: pointer;" onclick="hideNewDMModal()">Cancel</button>
    </div>
  </div>

`;

content = content.replace('</body>', dmPanelHTML + '</body>');

// 4. Add DM JavaScript functions before </script>
const dmJS = `

    // =========================================
    // DIRECT MESSAGING SYSTEM
    // =========================================

    let dmPanelOpen = false;
    let currentDMConversation = null;
    let dmPendingAttachment = null;
    let dmKnownUsers = [];

    function toggleDMPanel() {
      dmPanelOpen = !dmPanelOpen;
      document.getElementById('dmPanel').classList.toggle('active', dmPanelOpen);
      if (dmPanelOpen) {
        loadDMConversations();
      }
    }

    async function loadDMConversations() {
      try {
        const res = await fetch(API_BASE + '/dm?userId=' + encodeURIComponent(USERNAME), {
          credentials: 'include'
        });
        const data = await res.json();

        const container = document.getElementById('dmConversations');

        if (!data.conversations || data.conversations.length === 0) {
          container.innerHTML = \`
            <div class="dm-empty">
              <div class="dm-empty-icon">💬</div>
              <div>No conversations yet</div>
              <div style="font-size: 12px; margin-top: 4px;">Start a direct message with someone</div>
            </div>
          \`;
          return;
        }

        container.innerHTML = data.conversations.map(convo => {
          const otherUser = convo.participants.find(p => p !== USERNAME) || convo.participants[0];
          const otherType = convo.participantTypes[otherUser] || 'agent';
          const unread = convo.unreadCount?.[USERNAME] || 0;
          const lastMsg = convo.lastMessage;
          const timeAgo = lastMsg ? formatTimeAgo(new Date(lastMsg.timestamp)) : '';

          return \`
            <div class="dm-convo-item \${unread > 0 ? 'unread' : ''}" onclick="openDMChat('\${convo.id}', '\${escapeHtml(otherUser)}', '\${otherType}')">
              <div class="dm-convo-header">
                <div class="dm-convo-name">
                  <span>\${otherType === 'agent' ? '🤖' : '👤'}</span>
                  <span>\${escapeHtml(otherUser)}</span>
                  \${unread > 0 ? \`<span class="dm-unread-badge">\${unread}</span>\` : ''}
                </div>
                <span class="dm-convo-time">\${timeAgo}</span>
              </div>
              <div class="dm-convo-preview">\${lastMsg ? escapeHtml(lastMsg.preview) : 'No messages'}</div>
            </div>
          \`;
        }).join('');

        // Update badge
        updateDMBadge(data.totalUnread);

      } catch (e) {
        console.error('Failed to load DM conversations:', e);
      }
    }

    async function openDMChat(conversationId, recipientName, recipientType) {
      currentDMConversation = { id: conversationId, recipient: recipientName, type: recipientType };

      document.getElementById('dmConversationsList').style.display = 'none';
      document.getElementById('dmChatView').classList.add('active');
      document.getElementById('dmChatRecipient').textContent = recipientName;
      document.getElementById('dmChatRecipientType').textContent = recipientType === 'agent' ? '🤖 Agent' : '👤 Human';

      await loadDMMessages(conversationId);
    }

    async function loadDMMessages(conversationId) {
      try {
        const res = await fetch(API_BASE + '/dm?conversationId=' + encodeURIComponent(conversationId) + '&userId=' + encodeURIComponent(USERNAME), {
          credentials: 'include'
        });
        const data = await res.json();

        const container = document.getElementById('dmChatMessages');

        if (!data.messages || data.messages.length === 0) {
          container.innerHTML = '<div class="dm-empty" style="padding: 20px;"><div>No messages yet</div></div>';
          return;
        }

        container.innerHTML = data.messages.map(msg => {
          const isSent = msg.from === USERNAME;
          const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

          let attachmentHTML = '';
          if (msg.attachments && msg.attachments.length > 0) {
            attachmentHTML = msg.attachments.map(att => {
              if (att.type === 'image') {
                return \`<div class="dm-message-attachment"><img src="\${att.data}" alt="\${escapeHtml(att.name)}" onclick="window.open(this.src)" /></div>\`;
              }
              return \`<div class="dm-message-attachment">📎 \${escapeHtml(att.name)}</div>\`;
            }).join('');
          }

          return \`
            <div class="dm-message \${isSent ? 'sent' : 'received'}">
              <div>\${escapeHtml(msg.message)}</div>
              \${attachmentHTML}
              <div class="dm-message-time">\${time}\${msg.read && isSent ? ' ✓' : ''}</div>
            </div>
          \`;
        }).join('');

        container.scrollTop = container.scrollHeight;

        // Refresh badge
        checkDMUnread();

      } catch (e) {
        console.error('Failed to load DM messages:', e);
      }
    }

    function closeDMChat() {
      currentDMConversation = null;
      document.getElementById('dmChatView').classList.remove('active');
      document.getElementById('dmConversationsList').style.display = 'block';
      loadDMConversations();
    }

    function handleDMKeypress(event) {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendDM();
      }
    }

    async function sendDM() {
      const input = document.getElementById('dmMessageInput');
      const message = input.value.trim();

      if (!message && !dmPendingAttachment) return;
      if (!currentDMConversation) return;

      const payload = {
        from: USERNAME,
        fromType: 'human',
        to: currentDMConversation.recipient,
        toType: currentDMConversation.type,
        message: message
      };

      if (dmPendingAttachment) {
        payload.attachments = [dmPendingAttachment];
        dmPendingAttachment = null;
      }

      input.value = '';

      try {
        const res = await fetch(API_BASE + '/dm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(payload)
        });

        if (res.ok) {
          // If this was a new conversation, update the ID
          const data = await res.json();
          if (!currentDMConversation.id && data.conversationId) {
            currentDMConversation.id = data.conversationId;
          }
          await loadDMMessages(currentDMConversation.id || data.conversationId);
        }
      } catch (e) {
        console.error('Failed to send DM:', e);
      }
    }

    async function checkDMUnread() {
      try {
        const res = await fetch(API_BASE + '/dm?userId=' + encodeURIComponent(USERNAME) + '&checkUnread=true', {
          credentials: 'include'
        });
        const data = await res.json();
        updateDMBadge(data.totalUnread || 0);
      } catch (e) {
        console.error('Failed to check DM unread:', e);
      }
    }

    function updateDMBadge(count) {
      const badge = document.getElementById('dmBadgeCount');
      if (count > 0) {
        badge.textContent = count > 99 ? '99+' : count;
        badge.style.display = 'flex';
      } else {
        badge.style.display = 'none';
      }
    }

    function showNewDMModal() {
      document.getElementById('dmNewModal').classList.add('active');
      loadDMUserList();
    }

    function hideNewDMModal() {
      document.getElementById('dmNewModal').classList.remove('active');
    }

    async function loadDMUserList() {
      try {
        // Get agents
        const agentsRes = await fetch(API_BASE + '/agents', { credentials: 'include' });
        const agentsData = await agentsRes.json();

        dmKnownUsers = (agentsData.agents || []).map(a => ({
          id: a.id,
          name: a.name || a.id,
          type: 'agent'
        }));

        // Add some known humans if any (you could fetch from users endpoint if available)
        // For now, just show agents

        renderDMUserList();
      } catch (e) {
        console.error('Failed to load user list:', e);
      }
    }

    function filterDMUsers() {
      renderDMUserList();
    }

    function renderDMUserList() {
      const search = document.getElementById('dmSearchUser').value.toLowerCase();
      const filtered = dmKnownUsers.filter(u =>
        u.name.toLowerCase().includes(search) || u.id.toLowerCase().includes(search)
      );

      const container = document.getElementById('dmUserList');
      if (filtered.length === 0) {
        container.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-secondary);">No users found</div>';
        return;
      }

      container.innerHTML = filtered.map(user => \`
        <div class="dm-user-item" onclick="startDMWith('\${escapeHtml(user.id)}', '\${user.type}')">
          <div class="dm-user-avatar \${user.type}">\${user.name.substring(0, 2).toUpperCase()}</div>
          <div>
            <div style="font-weight: 600;">\${escapeHtml(user.name)}</div>
            <div style="font-size: 11px; color: var(--text-secondary);">\${user.type === 'agent' ? '🤖 Agent' : '👤 Human'}</div>
          </div>
        </div>
      \`).join('');
    }

    function startDMWith(userId, userType) {
      hideNewDMModal();
      currentDMConversation = { id: null, recipient: userId, type: userType };
      document.getElementById('dmConversationsList').style.display = 'none';
      document.getElementById('dmChatView').classList.add('active');
      document.getElementById('dmChatRecipient').textContent = userId;
      document.getElementById('dmChatRecipientType').textContent = userType === 'agent' ? '🤖 Agent' : '👤 Human';
      document.getElementById('dmChatMessages').innerHTML = '<div class="dm-empty" style="padding: 20px;"><div>Start the conversation!</div></div>';
    }

    function formatTimeAgo(date) {
      const now = new Date();
      const diff = now - date;
      const mins = Math.floor(diff / 60000);
      const hours = Math.floor(diff / 3600000);
      const days = Math.floor(diff / 86400000);

      if (mins < 1) return 'now';
      if (mins < 60) return mins + 'm';
      if (hours < 24) return hours + 'h';
      return days + 'd';
    }

    // Handle file attachment
    document.addEventListener('DOMContentLoaded', function() {
      const fileInput = document.getElementById('dmFileInput');
      if (fileInput) {
        fileInput.addEventListener('change', function(e) {
          const file = e.target.files[0];
          if (!file) return;

          const reader = new FileReader();
          reader.onload = function(e) {
            dmPendingAttachment = {
              id: 'att-' + Date.now(),
              type: file.type.startsWith('image/') ? 'image' : 'file',
              name: file.name,
              mimeType: file.type,
              size: file.size,
              data: e.target.result
            };
            // Show preview in input area
            document.getElementById('dmMessageInput').placeholder = '📎 ' + file.name + ' attached - type message or send';
          };
          reader.readAsDataURL(file);
        });
      }

      // Check for DM unread on load
      setTimeout(checkDMUnread, 2000);
      // Poll for new DMs every 30 seconds
      setInterval(checkDMUnread, 30000);
    });

`;

content = content.replace('  </script>', dmJS + '  </script>');

fs.writeFileSync(filePath, content, 'utf8');
console.log('Direct Messaging UI added successfully!');
console.log('');
console.log('Features:');
console.log('- DM button in header with unread badge');
console.log('- Slide-out DM panel');
console.log('- Conversation list with previews');
console.log('- Chat view with message history');
console.log('- File/image attachment support');
console.log('- New message modal to start conversations');
console.log('- Auto-polling for new messages');
