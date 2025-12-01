const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'web', 'index.html');
let content = fs.readFileSync(filePath, 'utf8');

// Add register function after login function
const oldLogin = `    async function login(username, password) {
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

    function showLoginModal()`;

const newLogin = `    async function login(username, password) {
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

    async function register(username, password, inviteCode) {
      try {
        const res = await fetch(API_BASE + '/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ username, password, inviteCode })
        });
        const data = await res.json();
        if (data.success) {
          return { success: true, user: data.user };
        }
        return { success: false, error: data.error || 'Registration failed' };
      } catch (e) {
        return { success: false, error: 'Network error' };
      }
    }

    function showLoginModal()`;

content = content.replace(oldLogin, newLogin);

// Add setupRegisterForm and toggle functions after setupLoginForm
const oldSetupLogin = `    function setupLoginForm() {
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

// Initialize`;

const newSetupLogin = `    function setupLoginForm() {
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

    function setupRegisterForm() {
      const form = document.getElementById('registerForm');
      const errorDiv = document.getElementById('registerError');
      const successDiv = document.getElementById('registerSuccess');

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        errorDiv.style.display = 'none';
        successDiv.style.display = 'none';

        const username = document.getElementById('regUsername').value;
        const password = document.getElementById('regPassword').value;
        const passwordConfirm = document.getElementById('regPasswordConfirm').value;
        const inviteCode = document.getElementById('regInviteCode').value;

        if (password !== passwordConfirm) {
          errorDiv.textContent = 'Passwords do not match';
          errorDiv.style.display = 'block';
          return;
        }

        const result = await register(username, password, inviteCode);
        if (result.success) {
          successDiv.textContent = 'Account created! You can now login.';
          successDiv.style.display = 'block';
          form.reset();
          setTimeout(() => toggleAuthMode(), 2000);
        } else {
          errorDiv.textContent = result.error;
          errorDiv.style.display = 'block';
        }
      });
    }

    function toggleAuthMode() {
      const loginForm = document.getElementById('loginForm');
      const registerForm = document.getElementById('registerForm');
      const title = document.getElementById('authTitle');
      const subtitle = document.getElementById('authSubtitle');
      const toggleText = document.getElementById('authToggleText');
      const toggleLink = document.getElementById('authToggleLink');

      if (loginForm.style.display !== 'none') {
        loginForm.style.display = 'none';
        registerForm.style.display = 'block';
        title.textContent = '📝 Create Account';
        subtitle.textContent = 'Register to join the Piston Labs Agent Hub';
        toggleText.textContent = 'Already have an account?';
        toggleLink.textContent = 'Login';
      } else {
        loginForm.style.display = 'block';
        registerForm.style.display = 'none';
        title.textContent = '🔐 Piston Labs Agent Hub';
        subtitle.textContent = 'Login required to access the coordination system';
        toggleText.textContent = "Don't have an account?";
        toggleLink.textContent = 'Register';
      }

      // Clear error messages
      document.getElementById('loginError').style.display = 'none';
      document.getElementById('registerError').style.display = 'none';
      document.getElementById('registerSuccess').style.display = 'none';
    }

    function setupAuthToggle() {
      document.getElementById('authToggleLink').addEventListener('click', (e) => {
        e.preventDefault();
        toggleAuthMode();
      });
    }

// Initialize`;

content = content.replace(oldSetupLogin, newSetupLogin);

// Update the DOMContentLoaded to call setupRegisterForm and setupAuthToggle
const oldDOMContent = `      setupLoginForm();

      const authenticated = await checkSession();`;

const newDOMContent = `      setupLoginForm();
      setupRegisterForm();
      setupAuthToggle();

      const authenticated = await checkSession();`;

content = content.replace(oldDOMContent, newDOMContent);

fs.writeFileSync(filePath, content, 'utf8');
console.log('Registration UI added successfully');
