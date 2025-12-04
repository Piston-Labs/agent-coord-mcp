const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'web', 'index.html');
let content = fs.readFileSync(filePath, 'utf8');

// Add login overlay CSS before </style>
const loginCSS = `
    /* Login overlay styles */
    .login-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(13, 17, 23, 0.95);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
    }

    .login-modal {
      background: var(--panel-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 32px;
      width: 100%;
      max-width: 380px;
      text-align: center;
    }

    .login-modal h2 {
      margin: 0 0 8px 0;
      color: var(--text-primary);
    }

    .login-modal .form-group {
      margin-bottom: 16px;
      text-align: left;
    }

    .login-modal .form-group label {
      display: block;
      margin-bottom: 6px;
      color: var(--text-secondary);
      font-size: 13px;
    }

    .login-modal .form-group input {
      width: 100%;
      padding: 10px 12px;
      background: var(--input-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--text-primary);
      font-size: 14px;
    }

    .login-modal .btn-primary {
      background: var(--accent);
      color: white;
      border: none;
      padding: 12px 24px;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
    }

    .login-modal .btn-primary:hover {
      background: #1f6feb;
    }

`;

// Add CSS before </style>
content = content.replace(/(\s*)<\/style>/, loginCSS + '$1</style>');

// Add login HTML after <body>
const loginHTML = `
  <!-- Login Modal -->
  <div id="loginOverlay" class="login-overlay" style="display: none;">
    <div class="login-modal">
      <h2>🔐 Piston Labs Agent Hub</h2>
      <p style="color: var(--text-secondary); margin-bottom: 20px;">Login required to access the coordination system</p>
      <form id="loginForm">
        <div class="form-group">
          <label>Username</label>
          <input type="text" id="loginUsername" placeholder="Enter username" required />
        </div>
        <div class="form-group">
          <label>Password</label>
          <input type="password" id="loginPassword" placeholder="Enter password" required />
        </div>
        <div id="loginError" style="color: #f85149; margin-bottom: 12px; display: none;"></div>
        <button type="submit" class="btn-primary" style="width: 100%;">Login</button>
      </form>
    </div>
  </div>

`;

content = content.replace(/<body>/, '<body>' + loginHTML);

fs.writeFileSync(filePath, content, 'utf8');
console.log('Auth UI added successfully');
