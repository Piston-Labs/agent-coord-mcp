// === BLOG STUDIO FUNCTIONS ===
// Blog generation UI with Claude-powered content creation

let blogSessions = [];
let currentBlogSession = null;
let blogInitialized = false;

async function initBlogStudio() {
  if (blogInitialized) return;
  blogInitialized = true;
  await fetchBlogSessions();
}

async function fetchBlogSessions() {
  try {
    const res = await fetch(`${API_BASE}/blog?action=list-sessions`);
    const data = await res.json();
    blogSessions = data.sessions || [];
    renderBlogSessionsList();
  } catch (err) {
    console.error('Failed to fetch blog sessions:', err);
  }
}

function renderBlogSessionsList() {
  const container = document.getElementById('blogSessionsList');
  if (!container) return;

  if (blogSessions.length === 0) {
    container.innerHTML = `
      <div class="blog-empty-state">
        <span>No sessions yet</span>
        <small>Create a new session to start writing</small>
      </div>
    `;
    return;
  }

  container.innerHTML = blogSessions.map(session => `
    <div class="blog-session-item ${currentBlogSession?.id === session.id ? 'active' : ''}"
         onclick="selectBlogSession('${session.id}')">
      <h4>${escapeHtml(session.title || session.topic)}</h4>
      <small>${new Date(session.createdAt).toLocaleDateString()}</small>
      <div class="blog-session-status ${session.status}">${session.status}</div>
    </div>
  `).join('');
}

async function selectBlogSession(sessionId) {
  try {
    const res = await fetch(`${API_BASE}/blog?action=get-session&sessionId=${sessionId}`);
    const data = await res.json();
    currentBlogSession = data.session;

    document.getElementById('blogSessionTitle').textContent = currentBlogSession.title || currentBlogSession.topic;
    document.getElementById('blogSessionMeta').textContent = `${currentBlogSession.messageCount} messages • Created ${new Date(currentBlogSession.createdAt).toLocaleDateString()}`;
    document.getElementById('saveDraftBtn').disabled = false;
    document.getElementById('spawnAgentBtn').disabled = false;
    document.getElementById('blogInputArea').style.display = 'block';

    renderBlogMessages(data.messages || []);
    renderBlogSessionsList();

    if (data.draft) {
      renderBlogDraftPreview(data.draft);
    }
  } catch (err) {
    console.error('Failed to load session:', err);
    alert('Failed to load session');
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
    return `
      <div class="blog-message ${msg.role}">
        <div class="blog-message-avatar">${avatar}</div>
        <div class="blog-message-content">
          <p>${escapeHtml(msg.content)}</p>
          <div class="blog-message-meta">${msg.author} • ${new Date(msg.timestamp).toLocaleTimeString()}</div>
        </div>
      </div>
    `;
  }).join('');

  container.scrollTop = container.scrollHeight;
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
        <button class="blog-modal-btn primary" onclick="submitBlogSession()">Create Session</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  document.getElementById('blogTopicInput').focus();
}

function closeBlogModal() {
  const modal = document.getElementById('blogNewSessionModal') || document.getElementById('blogResearchModal');
  if (modal) modal.remove();
}

async function submitBlogSession() {
  const topic = document.getElementById('blogTopicInput').value.trim();
  const title = document.getElementById('blogTitleInput').value.trim();

  if (!topic) {
    alert('Please enter a topic');
    return;
  }

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
      await fetchBlogSessions();
      await selectBlogSession(data.session.id);
    } else {
      alert(data.error || 'Failed to create session');
    }
  } catch (err) {
    console.error('Failed to create session:', err);
    alert('Failed to create session');
  }
}

function handleBlogKeypress(event) {
  if (event.key === 'Enter') {
    sendBlogMessage();
  }
}

async function sendBlogMessage() {
  if (!currentBlogSession) {
    alert('Please select or create a session first');
    return;
  }

  const input = document.getElementById('blogMessageInput');
  const content = input.value.trim();
  if (!content) return;

  input.value = '';

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
    alert('Failed to send message');
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
  resultsContainer.innerHTML = '<p style="text-align: center;">Searching...</p>';

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
    alert('Please create a session first to add research');
    return;
  }

  const input = document.getElementById('blogMessageInput');
  input.value = `I'd like to reference this research: "${title}"\n\nSummary: ${summary}`;
  closeBlogModal();
  input.focus();
}

async function saveBlogDraft() {
  if (!currentBlogSession) {
    alert('No session selected');
    return;
  }

  const res = await fetch(`${API_BASE}/blog?action=get-session&sessionId=${currentBlogSession.id}`);
  const data = await res.json();

  const assistantMessages = (data.messages || [])
    .filter(m => m.role === 'assistant')
    .map(m => m.content)
    .join('\n\n');

  if (!assistantMessages) {
    alert('No content to save as draft. Generate some content first by chatting with the Blog Assistant.');
    return;
  }

  try {
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
      alert('Draft saved successfully!');
      renderBlogDraftPreview(saveData.draft);
    } else {
      alert(saveData.error || 'Failed to save draft');
    }
  } catch (err) {
    console.error('Failed to save draft:', err);
    alert('Failed to save draft');
  }
}

async function spawnBlogAgent() {
  if (!currentBlogSession) {
    alert('Please create a session first');
    return;
  }

  const btn = document.getElementById('spawnAgentBtn');
  const originalText = btn.innerHTML;
  btn.innerHTML = '<span>⏳</span> Generating...';
  btn.disabled = true;

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
    } else {
      alert(data.error || 'Failed to generate content');
    }
  } catch (err) {
    console.error('Failed to generate:', err);
    alert('Failed to generate content. Make sure the API is configured.');
  } finally {
    btn.innerHTML = originalText;
    btn.disabled = false;
  }
}

function toggleBlogPreview() {
  const panel = document.getElementById('blogPreviewPanel');
  panel.classList.toggle('hidden');
}
