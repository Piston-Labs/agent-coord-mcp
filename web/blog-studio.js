// === BLOG STUDIO FUNCTIONS ===
// Blog generation UI with Claude-powered content creation

let blogSessions = [];
let currentBlogSession = null;
let blogInitialized = false;

// Toast notification helper
function showBlogToast(message, type = 'info') {
  const existing = document.querySelector('.blog-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `blog-toast blog-toast-${type}`;
  toast.innerHTML = `
    <span class="blog-toast-icon">${type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ'}</span>
    <span class="blog-toast-message">${message}</span>
  `;
  document.body.appendChild(toast);

  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// Loading state helper
function setBlogLoading(element, loading, text = 'Loading...') {
  if (!element) return;
  if (loading) {
    element.dataset.originalContent = element.innerHTML;
    element.innerHTML = `<div class="blog-loading"><span class="blog-spinner"></span>${text}</div>`;
  } else if (element.dataset.originalContent) {
    element.innerHTML = element.dataset.originalContent;
    delete element.dataset.originalContent;
  }
}

async function initBlogStudio() {
  if (blogInitialized) return;
  blogInitialized = true;
  await fetchBlogSessions();
}

async function fetchBlogSessions() {
  const container = document.getElementById('blogSessionsList');
  setBlogLoading(container, true, 'Loading sessions...');

  try {
    const res = await fetch(`${API_BASE}/blog?action=list-sessions`);
    const data = await res.json();
    blogSessions = data.sessions || [];
    renderBlogSessionsList();
  } catch (err) {
    console.error('Failed to fetch blog sessions:', err);
    showBlogToast('Failed to load sessions', 'error');
    if (container) {
      container.innerHTML = `
        <div class="blog-empty-state blog-error-state">
          <span>⚠️</span>
          <small>Failed to load sessions</small>
          <button class="blog-retry-btn" onclick="fetchBlogSessions()">Retry</button>
        </div>
      `;
    }
  }
}

function renderBlogSessionsList() {
  const container = document.getElementById('blogSessionsList');
  if (!container) return;

  if (blogSessions.length === 0) {
    container.innerHTML = `
      <div class="blog-empty-state">
        <span>📝</span>
        <small>No sessions yet</small>
        <small style="opacity: 0.7;">Create a new session to start writing</small>
      </div>
    `;
    return;
  }

  container.innerHTML = blogSessions.map(session => `
    <div class="blog-session-item ${currentBlogSession?.id === session.id ? 'active' : ''}"
         onclick="selectBlogSession('${session.id}')">
      <div class="blog-session-item-header">
        <h4>${escapeHtml(session.title || session.topic)}</h4>
        <button class="blog-session-delete" onclick="event.stopPropagation(); deleteBlogSession('${session.id}')" title="Delete session">×</button>
      </div>
      <small>${new Date(session.createdAt).toLocaleDateString()}</small>
      <div class="blog-session-status ${session.status}">${session.status}</div>
    </div>
  `).join('');
}

async function selectBlogSession(sessionId) {
  const chatContainer = document.getElementById('blogChat');
  setBlogLoading(chatContainer, true, 'Loading conversation...');

  try {
    const res = await fetch(`${API_BASE}/blog?action=get-session&sessionId=${sessionId}`);
    const data = await res.json();

    if (!data.session) {
      throw new Error('Session not found');
    }

    currentBlogSession = data.session;

    document.getElementById('blogSessionTitle').textContent = currentBlogSession.title || currentBlogSession.topic;
    document.getElementById('blogSessionMeta').textContent = `${currentBlogSession.messageCount || 0} messages • Created ${new Date(currentBlogSession.createdAt).toLocaleDateString()}`;
    document.getElementById('saveDraftBtn').disabled = false;
    document.getElementById('spawnAgentBtn').disabled = false;
    document.getElementById('blogInputArea').style.display = 'block';

    renderBlogMessages(data.messages || []);
    renderBlogSessionsList();

    if (data.draft) {
      renderBlogDraftPreview(data.draft);
    } else {
      renderBlogDraftPreview(null);
    }

    // Focus the input
    document.getElementById('blogMessageInput')?.focus();
  } catch (err) {
    console.error('Failed to load session:', err);
    showBlogToast('Failed to load session', 'error');
    setBlogLoading(chatContainer, false);
  }
}

async function deleteBlogSession(sessionId) {
  if (!confirm('Are you sure you want to delete this session? This cannot be undone.')) {
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/blog?action=delete-session&sessionId=${sessionId}`, {
      method: 'DELETE'
    });
    const data = await res.json();

    if (data.success) {
      showBlogToast('Session deleted', 'success');

      // Clear current session if it was deleted
      if (currentBlogSession?.id === sessionId) {
        currentBlogSession = null;
        document.getElementById('blogSessionTitle').textContent = 'Blog Studio';
        document.getElementById('blogSessionMeta').textContent = 'Select or create a session to begin';
        document.getElementById('saveDraftBtn').disabled = true;
        document.getElementById('spawnAgentBtn').disabled = true;
        document.getElementById('blogInputArea').style.display = 'none';
        document.getElementById('blogChat').innerHTML = `
          <div class="blog-welcome">
            <div class="blog-welcome-icon">✍️</div>
            <h3>Welcome to Blog Studio</h3>
            <p>Create compelling blog posts with AI assistance. Pull from our research library, collaborate with the Blog Assistant, and generate polished content.</p>
          </div>
        `;
        renderBlogDraftPreview(null);
      }

      await fetchBlogSessions();
    } else {
      showBlogToast(data.error || 'Failed to delete session', 'error');
    }
  } catch (err) {
    console.error('Failed to delete session:', err);
    showBlogToast('Failed to delete session', 'error');
  }
}

function renderBlogMessages(messages) {
  const container = document.getElementById('blogChat');
  if (!container) return;

  if (messages.length === 0) {
    container.innerHTML = `
      <div class="blog-welcome">
        <div class="blog-welcome-icon">💬</div>
        <h3>Ready to Write</h3>
        <p>Start the conversation by typing a message below, or click "Generate" to bring in the AI writer.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = messages.map(msg => {
    const avatar = msg.role === 'user' ? '👤' : (msg.role === 'assistant' ? '✍️' : '📋');
    const roleLabel = msg.role === 'user' ? 'You' : (msg.role === 'assistant' ? 'Blog Assistant' : 'System');
    return `
      <div class="blog-message ${msg.role}">
        <div class="blog-message-avatar">${avatar}</div>
        <div class="blog-message-content">
          <div class="blog-message-header">
            <span class="blog-message-author">${roleLabel}</span>
            <span class="blog-message-time">${new Date(msg.timestamp).toLocaleTimeString()}</span>
          </div>
          <p>${escapeHtml(msg.content)}</p>
        </div>
      </div>
    `;
  }).join('');

  // Auto-scroll to bottom
  setTimeout(() => {
    container.scrollTop = container.scrollHeight;
  }, 100);
}

function renderBlogDraftPreview(draft) {
  const content = document.getElementById('blogPreviewContent');
  const stats = document.getElementById('blogPreviewStats');

  if (!draft || !draft.content) {
    content.innerHTML = `
      <div class="blog-preview-empty">
        <span>📝</span>
        <p>Draft will appear here as you write</p>
      </div>
    `;
    stats.innerHTML = '<span>0 words</span><span>~0 min read</span>';
    return;
  }

  content.innerHTML = `
    <h2 style="margin-top:0;">${escapeHtml(draft.title)}</h2>
    <div style="white-space: pre-wrap; line-height: 1.7;">${escapeHtml(draft.content)}</div>
  `;

  const wordCount = draft.metadata?.wordCount || draft.content.split(/\s+/).length;
  const readTime = Math.ceil(wordCount / 200);
  stats.innerHTML = `<span>${wordCount} words</span><span>~${readTime} min read</span>`;
}

function createBlogSession() {
  const modal = document.createElement('div');
  modal.className = 'blog-modal';
  modal.id = 'blogNewSessionModal';
  modal.innerHTML = `
    <div class="blog-modal-content">
      <div class="blog-modal-header">
        <h3>New Blog Session</h3>
        <button class="blog-modal-close" onclick="closeBlogModal()">&times;</button>
      </div>
      <div class="blog-modal-body">
        <div class="blog-form-group">
          <label>Topic *</label>
          <input type="text" id="blogTopicInput" placeholder="e.g., Benefits of vehicle telemetry for auto shops" />
        </div>
        <div class="blog-form-group">
          <label>Title (optional)</label>
          <input type="text" id="blogTitleInput" placeholder="Leave blank to auto-generate" />
        </div>
      </div>
      <div class="blog-modal-actions">
        <button class="blog-modal-btn cancel" onclick="closeBlogModal()">Cancel</button>
        <button class="blog-modal-btn primary" id="createSessionBtn" onclick="submitBlogSession()">Create Session</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  // Add enter key handler
  const topicInput = document.getElementById('blogTopicInput');
  const titleInput = document.getElementById('blogTitleInput');
  topicInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') titleInput.focus(); });
  titleInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') submitBlogSession(); });
  topicInput.focus();
}

function closeBlogModal() {
  const modal = document.getElementById('blogNewSessionModal') || document.getElementById('blogResearchModal');
  if (modal) modal.remove();
}

async function submitBlogSession() {
  const topic = document.getElementById('blogTopicInput').value.trim();
  const title = document.getElementById('blogTitleInput').value.trim();
  const btn = document.getElementById('createSessionBtn');

  if (!topic) {
    showBlogToast('Please enter a topic', 'error');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Creating...';

  try {
    const res = await fetch(`${API_BASE}/blog?action=create-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topic,
        title: title || null,
        createdBy: currentUsername || 'user'
      })
    });

    const data = await res.json();
    if (data.success) {
      closeBlogModal();
      showBlogToast('Session created!', 'success');
      await fetchBlogSessions();
      await selectBlogSession(data.session.id);
    } else {
      showBlogToast(data.error || 'Failed to create session', 'error');
      btn.disabled = false;
      btn.textContent = 'Create Session';
    }
  } catch (err) {
    console.error('Failed to create session:', err);
    showBlogToast('Failed to create session', 'error');
    btn.disabled = false;
    btn.textContent = 'Create Session';
  }
}

function handleBlogKeypress(event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendBlogMessage();
  }
}

async function sendBlogMessage() {
  if (!currentBlogSession) {
    showBlogToast('Please select or create a session first', 'error');
    return;
  }

  const input = document.getElementById('blogMessageInput');
  const sendBtn = document.querySelector('.blog-send-btn');
  const content = input.value.trim();
  if (!content) return;

  // Optimistic UI update
  const chatContainer = document.getElementById('blogChat');
  const tempMsg = document.createElement('div');
  tempMsg.className = 'blog-message user';
  tempMsg.innerHTML = `
    <div class="blog-message-avatar">👤</div>
    <div class="blog-message-content">
      <div class="blog-message-header">
        <span class="blog-message-author">You</span>
        <span class="blog-message-time">${new Date().toLocaleTimeString()}</span>
      </div>
      <p>${escapeHtml(content)}</p>
    </div>
  `;

  // Remove welcome message if present
  const welcome = chatContainer.querySelector('.blog-welcome');
  if (welcome) welcome.remove();

  chatContainer.appendChild(tempMsg);
  chatContainer.scrollTop = chatContainer.scrollHeight;

  input.value = '';
  input.disabled = true;
  sendBtn.disabled = true;

  try {
    await fetch(`${API_BASE}/blog?action=send-message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: currentBlogSession.id,
        content,
        author: currentUsername || 'user',
        role: 'user'
      })
    });

    await selectBlogSession(currentBlogSession.id);
  } catch (err) {
    console.error('Failed to send message:', err);
    showBlogToast('Failed to send message', 'error');
    tempMsg.remove();
    input.value = content;
  } finally {
    input.disabled = false;
    sendBtn.disabled = false;
    input.focus();
  }
}

function searchBlogResearch() {
  const modal = document.createElement('div');
  modal.className = 'blog-modal';
  modal.id = 'blogResearchModal';
  modal.innerHTML = `
    <div class="blog-modal-content" style="max-width: 600px;">
      <div class="blog-modal-header">
        <h3>Search Research Library</h3>
        <button class="blog-modal-close" onclick="closeBlogModal()">&times;</button>
      </div>
      <div class="blog-modal-body">
        <div class="blog-form-group">
          <label>Search Query</label>
          <input type="text" id="blogResearchQuery" placeholder="e.g., telemetry benefits, fleet management ROI" onkeypress="if(event.key==='Enter')executeBlogSearch()" />
        </div>
        <div id="blogResearchResults" class="blog-research-results">
          <p style="color: var(--text-secondary); text-align: center;">Enter a query to search research library</p>
        </div>
      </div>
      <div class="blog-modal-actions">
        <button class="blog-modal-btn cancel" onclick="closeBlogModal()">Close</button>
        <button class="blog-modal-btn primary" onclick="executeBlogSearch()">Search</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  document.getElementById('blogResearchQuery').focus();
}

async function executeBlogSearch() {
  const query = document.getElementById('blogResearchQuery').value.trim();
  if (!query) return;

  const resultsContainer = document.getElementById('blogResearchResults');
  resultsContainer.innerHTML = '<div class="blog-loading"><span class="blog-spinner"></span>Searching...</div>';

  try {
    const sessionParam = currentBlogSession ? `&sessionId=${currentBlogSession.id}` : '';
    const res = await fetch(`${API_BASE}/blog?action=search-research&query=${encodeURIComponent(query)}&limit=10${sessionParam}`);
    const data = await res.json();

    if (!data.results || data.results.length === 0) {
      resultsContainer.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">No results found</p>';
      return;
    }

    resultsContainer.innerHTML = data.results.map(item => {
      const title = escapeHtml(item.title || item.id);
      const summary = escapeHtml((item.summary || item.content || '').substring(0, 200));
      return `
        <div class="blog-research-item" onclick="insertResearchToBlog('${title.replace(/'/g, "\\'")}', '${summary.replace(/'/g, "\\'")}')">
          <h4>${escapeHtml(item.title || 'Research Item')}</h4>
          <p>${escapeHtml((item.summary || item.content || '').substring(0, 150))}...</p>
          <div class="tags">
            ${(item.tags || []).slice(0, 4).map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error('Search failed:', err);
    resultsContainer.innerHTML = '<p style="text-align: center; color: var(--danger);">Search failed</p>';
  }
}

function insertResearchToBlog(title, summary) {
  if (!currentBlogSession) {
    showBlogToast('Please create a session first to add research', 'error');
    return;
  }

  const input = document.getElementById('blogMessageInput');
  input.value = `I'd like to reference this research: "${title}"\n\nSummary: ${summary}`;
  closeBlogModal();
  input.focus();
  showBlogToast('Research added to message', 'success');
}

async function saveBlogDraft() {
  if (!currentBlogSession) {
    showBlogToast('No session selected', 'error');
    return;
  }

  const btn = document.getElementById('saveDraftBtn');
  const originalText = btn.innerHTML;
  btn.innerHTML = '<span>⏳</span> Saving...';
  btn.disabled = true;

  try {
    const res = await fetch(`${API_BASE}/blog?action=get-session&sessionId=${currentBlogSession.id}`);
    const data = await res.json();

    const assistantMessages = (data.messages || [])
      .filter(m => m.role === 'assistant')
      .map(m => m.content)
      .join('\n\n');

    if (!assistantMessages) {
      showBlogToast('No content to save. Generate some content first!', 'error');
      return;
    }

    const saveRes = await fetch(`${API_BASE}/blog?action=save-draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: currentBlogSession.id,
        title: currentBlogSession.title || currentBlogSession.topic,
        content: assistantMessages,
        generatedBy: 'blog-assistant'
      })
    });

    const saveData = await saveRes.json();
    if (saveData.success) {
      showBlogToast('Draft saved!', 'success');
      renderBlogDraftPreview(saveData.draft);
    } else {
      showBlogToast(saveData.error || 'Failed to save draft', 'error');
    }
  } catch (err) {
    console.error('Failed to save draft:', err);
    showBlogToast('Failed to save draft', 'error');
  } finally {
    btn.innerHTML = originalText;
    btn.disabled = false;
  }
}

async function spawnBlogAgent() {
  if (!currentBlogSession) {
    showBlogToast('Please create a session first', 'error');
    return;
  }

  const btn = document.getElementById('spawnAgentBtn');
  const originalText = btn.innerHTML;
  btn.innerHTML = '<span class="blog-spinner-inline"></span> Generating...';
  btn.disabled = true;

  // Add typing indicator
  const chatContainer = document.getElementById('blogChat');
  const typingIndicator = document.createElement('div');
  typingIndicator.className = 'blog-message assistant blog-typing';
  typingIndicator.innerHTML = `
    <div class="blog-message-avatar">✍️</div>
    <div class="blog-message-content">
      <div class="blog-typing-indicator">
        <span></span><span></span><span></span>
      </div>
    </div>
  `;
  chatContainer.appendChild(typingIndicator);
  chatContainer.scrollTop = chatContainer.scrollHeight;

  try {
    // Get the last few messages for context
    const sessionRes = await fetch(`${API_BASE}/blog?action=get-session&sessionId=${currentBlogSession.id}`);
    const sessionData = await sessionRes.json();
    const recentMessages = (sessionData.messages || []).slice(-10);

    // Call the generate endpoint with soul-injected Claude
    const res = await fetch(`${API_BASE}/blog?action=generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: currentBlogSession.id,
        messages: recentMessages,
        topic: currentBlogSession.topic
      })
    });

    const data = await res.json();

    if (data.success && data.response) {
      // Add the response as an assistant message
      await fetch(`${API_BASE}/blog?action=send-message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: currentBlogSession.id,
          content: data.response,
          author: 'blog-assistant',
          role: 'assistant'
        })
      });

      // Reload the session
      await selectBlogSession(currentBlogSession.id);
      showBlogToast('Content generated!', 'success');
    } else {
      showBlogToast(data.error || 'Failed to generate content', 'error');
    }
  } catch (err) {
    console.error('Failed to generate:', err);
    showBlogToast('Failed to generate content. Check API configuration.', 'error');
  } finally {
    typingIndicator.remove();
    btn.innerHTML = originalText;
    btn.disabled = false;
  }
}

function toggleBlogPreview() {
  const panel = document.getElementById('blogPreviewPanel');
  panel.classList.toggle('hidden');
}
