const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'web', 'index.html');
let content = fs.readFileSync(filePath, 'utf8');

// Replace the 1024px media query with improved version
const oldMobile1024 = `    /* Mobile Responsiveness */
    @media (max-width: 1024px) {
      main {
        grid-template-columns: 1fr;
        grid-template-rows: auto 1fr auto;
      }

      .panel {
        height: auto;
        max-height: none;
      }

      /* Show only chat by default on tablet, make sidebars collapsible */
      .panel:first-child,
      .panel:last-child {
        display: none;
      }

      .panel:nth-child(2) {
        display: flex;
        height: calc(100vh - 53px);
      }
    }`;

const newMobile1024 = `    /* Mobile Responsiveness */
    @media (max-width: 1024px) {
      main {
        display: flex !important;
        flex-direction: column;
        height: calc(100vh - 53px);
        overflow: hidden;
      }

      /* Hide side panels on mobile - show only chat */
      .panel:first-child,
      .panel:last-child {
        display: none !important;
      }

      /* Chat panel takes full space */
      .panel:nth-child(2) {
        display: flex !important;
        flex-direction: column;
        flex: 1;
        height: 100%;
        width: 100%;
        max-height: none;
      }

      /* Ensure chat content fills available space */
      .tab-content.active {
        display: flex;
        flex-direction: column;
        flex: 1;
        overflow: hidden;
      }

      .chat-messages {
        flex: 1;
        overflow-y: auto;
      }

      .chat-input {
        flex-shrink: 0;
      }
    }`;

content = content.replace(oldMobile1024, newMobile1024);

// Replace the 768px media query too
const old768 = `    @media (max-width: 768px) {
      main {
        grid-template-columns: 1fr;
        height: calc(100vh - 50px);
      }`;

const new768 = `    @media (max-width: 768px) {
      main {
        display: flex !important;
        flex-direction: column;
        height: calc(100vh - 50px);
      }`;

content = content.replace(old768, new768);

fs.writeFileSync(filePath, content, 'utf8');
console.log('Mobile CSS fixed successfully');
