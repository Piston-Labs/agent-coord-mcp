const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'web', 'index.html');
let content = fs.readFileSync(filePath, 'utf8');

// Auth functions to add before init()
const authFunctions = `
    // Authentication functions
    let isAuthenticated = false;

    async function checkSession() {
      try {
        const res = await fetch(API_BASE + '/api/auth/session', {
          credentials: 'include'
        });
        const data = await res.json();
        return data.authenticated === true;
      } catch (e) {
        console.error('Session check failed:', e);
        return false;
      }
    }

    async function login(username, password) {
      try {
        const res = await fetch(API_BASE + '/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (data.success) {
          isAuthenticated = true;
          return { success: true };
        }
        return { success: false, error: data.error || 'Login failed' };
      } catch (e) {
        return { success: false, error: 'Network error' };
      }
    }

    function showLoginModal() {
      document.getElementById('loginOverlay').style.display = 'flex';
    }

    function hideLoginModal() {
      document.getElementById('loginOverlay').style.display = 'none';
    }

    function setupLoginForm() {
      const form = document.getElementById('loginForm');
      const errorDiv = document.getElementById('loginError');

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        errorDiv.style.display = 'none';

        const username = document.getElementById('loginUsername').value;
        const password = document.getElementById('loginPassword').value;

        const result = await login(username, password);
        if (result.success) {
          hideLoginModal();
          init();
        } else {
          errorDiv.textContent = result.error;
          errorDiv.style.display = 'block';
        }
      });
    }

`;

// Add auth functions before the init() function
content = content.replace(
  /(\/\/ Initialize\s*\n\s*async function init\(\))/,
  authFunctions + '$1'
);

// Modify the DOMContentLoaded to check auth first
const newDOMContentLoaded = `
    // Start app - check auth first
    document.addEventListener('DOMContentLoaded', async () => {
      setupLoginForm();

      const authenticated = await checkSession();
      if (authenticated) {
        isAuthenticated = true;
        hideLoginModal();
        init();
      } else {
        showLoginModal();
      }
    });
`;

// Replace the existing init() call
content = content.replace(
  /init\(\);\s*<\/script>/,
  newDOMContentLoaded + '\\n  </script>'
);

fs.writeFileSync(filePath, content, 'utf8');
console.log('Auth logic added successfully');
