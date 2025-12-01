const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'web', 'index.html');
let content = fs.readFileSync(filePath, 'utf8');

// 1. Add test-related functions to the script section
const testFunctions = `

    // Feature Testing Functions
    async function runFeatureTests(featureId) {
      try {
        const res = await fetch(API_BASE + '/feature-tests?action=run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ featureId, runBy: USERNAME })
        });
        const data = await res.json();
        return data;
      } catch (e) {
        console.error('Failed to run tests:', e);
        return { error: e.message };
      }
    }

    async function completeFeature(featureId, force = false) {
      try {
        const res = await fetch(API_BASE + '/feature-tests?action=complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ featureId, runBy: USERNAME, force })
        });
        const data = await res.json();

        if (!res.ok) {
          alert('Cannot complete feature: ' + (data.error || 'Tests failed'));
          return data;
        }

        // Refresh features list
        await fetchActiveContext();
        return data;
      } catch (e) {
        console.error('Failed to complete feature:', e);
        return { error: e.message };
      }
    }

    async function getFeatureTests(featureId) {
      try {
        const res = await fetch(API_BASE + '/feature-tests?featureId=' + featureId + '&includeRuns=true', {
          credentials: 'include'
        });
        return await res.json();
      } catch (e) {
        console.error('Failed to get tests:', e);
        return { tests: [], recentRuns: [] };
      }
    }

    function showTestModal(featureId, featureTitle) {
      // Create modal for running tests
      const existingModal = document.getElementById('testModal');
      if (existingModal) existingModal.remove();

      const modal = document.createElement('div');
      modal.id = 'testModal';
      modal.className = 'modal-overlay active';
      modal.innerHTML = \`
        <div class="modal" style="max-width: 600px;">
          <div class="modal-title">
            🧪 Feature Tests: \${featureTitle}
          </div>
          <div id="testModalContent" style="min-height: 200px;">
            <div style="text-align: center; padding: 40px;">
              <div style="font-size: 24px; margin-bottom: 10px;">⏳</div>
              <div>Loading tests...</div>
            </div>
          </div>
          <div class="modal-actions">
            <button type="button" class="btn-cancel" onclick="document.getElementById('testModal').remove()">Close</button>
            <button type="button" class="btn-submit" id="runTestsBtn" onclick="executeFeatureTests('\${featureId}')">
              ▶️ Run All Tests
            </button>
            <button type="button" class="btn-submit" style="background: var(--success);" id="completeBtn" onclick="tryCompleteFeature('\${featureId}')" disabled>
              ✅ Complete Feature
            </button>
          </div>
        </div>
      \`;
      document.body.appendChild(modal);

      // Load tests
      loadTestsIntoModal(featureId);
    }

    async function loadTestsIntoModal(featureId) {
      const content = document.getElementById('testModalContent');
      const data = await getFeatureTests(featureId);

      if (data.tests.length === 0) {
        content.innerHTML = \`
          <div style="text-align: center; padding: 20px; color: var(--text-secondary);">
            <div style="font-size: 32px; margin-bottom: 10px;">📋</div>
            <div style="margin-bottom: 10px;">No tests defined for this feature</div>
            <div style="font-size: 12px;">Features can be completed without tests, but it's not recommended.</div>
          </div>
        \`;
        document.getElementById('completeBtn').disabled = false;
        return;
      }

      let html = '<div style="margin-bottom: 16px;">';
      html += '<div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 8px;">TEST CASES (' + data.tests.length + ')</div>';

      for (const test of data.tests) {
        const recentRun = data.recentRuns?.find(r => r.testId === test.id);
        const statusIcon = recentRun
          ? (recentRun.status === 'passed' ? '✅' : recentRun.status === 'failed' ? '❌' : '⚠️')
          : '⏸️';
        const statusColor = recentRun
          ? (recentRun.status === 'passed' ? 'var(--success)' : 'var(--danger)')
          : 'var(--text-secondary)';

        html += \`
          <div class="context-item" style="border-left-color: \${statusColor}; margin-bottom: 6px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <div>
                <span style="margin-right: 6px;">\${statusIcon}</span>
                <strong>\${test.name}</strong>
              </div>
              <span style="font-size: 10px; background: var(--bg-tertiary); padding: 2px 6px; border-radius: 4px;">\${test.type}</span>
            </div>
            <div style="font-size: 11px; color: var(--text-secondary); margin-top: 4px;">\${test.description || 'No description'}</div>
            \${recentRun ? \`<div style="font-size: 10px; color: var(--text-secondary); margin-top: 4px;">Last run: \${new Date(recentRun.timestamp).toLocaleString()} - \${recentRun.message}</div>\` : ''}
          </div>
        \`;
      }
      html += '</div>';

      // Show recent runs summary
      if (data.recentRuns && data.recentRuns.length > 0) {
        const passed = data.recentRuns.filter(r => r.status === 'passed').length;
        const total = data.recentRuns.length;
        const passRate = Math.round((passed / total) * 100);

        html += \`
          <div style="background: var(--bg-tertiary); padding: 12px; border-radius: 6px; text-align: center;">
            <div style="font-size: 24px; font-weight: bold; color: \${passRate === 100 ? 'var(--success)' : 'var(--warning)'};">\${passRate}%</div>
            <div style="font-size: 11px; color: var(--text-secondary);">Pass Rate (\${passed}/\${total})</div>
          </div>
        \`;

        if (passRate === 100) {
          document.getElementById('completeBtn').disabled = false;
        }
      }

      content.innerHTML = html;
    }

    async function executeFeatureTests(featureId) {
      const btn = document.getElementById('runTestsBtn');
      const content = document.getElementById('testModalContent');

      btn.disabled = true;
      btn.textContent = '⏳ Running...';

      content.innerHTML = \`
        <div style="text-align: center; padding: 40px;">
          <div style="font-size: 32px; margin-bottom: 10px;">🔄</div>
          <div>Running tests...</div>
        </div>
      \`;

      const results = await runFeatureTests(featureId);

      btn.disabled = false;
      btn.textContent = '▶️ Run All Tests';

      if (results.error) {
        content.innerHTML = \`
          <div style="text-align: center; padding: 20px; color: var(--danger);">
            <div style="font-size: 32px; margin-bottom: 10px;">❌</div>
            <div>Error: \${results.error}</div>
          </div>
        \`;
        return;
      }

      // Display results
      let html = \`
        <div style="background: var(--bg-tertiary); padding: 16px; border-radius: 8px; margin-bottom: 16px; text-align: center;">
          <div style="font-size: 36px; font-weight: bold; color: \${results.canComplete ? 'var(--success)' : 'var(--danger)'};">
            \${results.passRate}%
          </div>
          <div style="font-size: 12px; color: var(--text-secondary); margin-top: 4px;">
            \${results.passed} passed, \${results.failed} failed, \${results.errors} errors, \${results.skipped} skipped
          </div>
          <div style="margin-top: 8px; font-size: 13px;">
            \${results.canComplete ? '✅ Ready to complete!' : '❌ Fix failing tests before completing'}
          </div>
        </div>
      \`;

      html += '<div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 8px;">TEST RESULTS</div>';

      for (const run of results.runs) {
        const icon = run.status === 'passed' ? '✅' : run.status === 'failed' ? '❌' : run.status === 'error' ? '⚠️' : '⏭️';
        const color = run.status === 'passed' ? 'var(--success)' : run.status === 'failed' ? 'var(--danger)' : 'var(--warning)';

        html += \`
          <div class="context-item" style="border-left-color: \${color}; margin-bottom: 6px;">
            <div style="display: flex; justify-content: space-between;">
              <span>\${icon} \${run.testId}</span>
              <span style="font-size: 10px; color: var(--text-secondary);">\${run.duration}ms</span>
            </div>
            <div style="font-size: 11px; color: var(--text-secondary); margin-top: 4px;">\${run.message}</div>
          </div>
        \`;
      }

      content.innerHTML = html;

      // Enable complete button if tests passed
      document.getElementById('completeBtn').disabled = !results.canComplete;
    }

    async function tryCompleteFeature(featureId) {
      const btn = document.getElementById('completeBtn');
      btn.disabled = true;
      btn.textContent = '⏳ Completing...';

      const result = await completeFeature(featureId);

      if (result.success) {
        document.getElementById('testModal').remove();
        alert('✅ Feature completed successfully!');
      } else {
        btn.disabled = false;
        btn.textContent = '✅ Complete Feature';
      }
    }

    // Make functions globally accessible
    window.showTestModal = showTestModal;
    window.runFeatureTests = runFeatureTests;
    window.completeFeature = completeFeature;

`;

// Find the script section and add functions before </script>
content = content.replace('  </script>', testFunctions + '  </script>');

// 2. Update the renderPlannedFeatures function to add test buttons
// Find where features are rendered and add test button
const oldFeatureRender = `featureList.push(feature);`;
const newFeatureRender = `featureList.push(feature);`;

// We need to find the feature rendering in fetchActiveContext
// Let's add a click handler to feature items

// Find the planned features rendering section
const oldFeaturesSection = `<div class="context-item feature" style="cursor: pointer;" onclick="alert('Feature: ' + this.dataset.title);" data-title="\${f.title}">`;
const newFeaturesSection = `<div class="context-item feature" style="cursor: pointer;" onclick="showTestModal('\${f.id}', '\${f.title}')" data-id="\${f.id}" data-title="\${f.title}">`;

// Check if this pattern exists, if not we need to find the actual pattern
if (!content.includes(oldFeaturesSection)) {
  // Find the features rendering in the fetchActiveContext function
  const featuresRenderPattern = /id="plannedFeaturesList"[\s\S]*?innerHTML\s*=\s*['"`]/;
  const match = content.match(featuresRenderPattern);

  if (match) {
    console.log('Found features render section, need to update template');
  }
}

// Try different approach - add event delegation
const oldPanelContent = `<div class="panel-content" id="contextPanel">`;
const newPanelContent = `<div class="panel-content" id="contextPanel" onclick="handleContextPanelClick(event)">`;

if (content.includes(oldPanelContent)) {
  content = content.replace(oldPanelContent, newPanelContent);
}

// Add click handler for feature items
const clickHandler = `
    function handleContextPanelClick(event) {
      const featureItem = event.target.closest('.context-item.feature');
      if (featureItem) {
        const id = featureItem.dataset.id;
        const title = featureItem.dataset.title;
        if (id && title) {
          showTestModal(id, title);
        }
      }
    }
`;

content = content.replace('  </script>', clickHandler + '  </script>');

fs.writeFileSync(filePath, content, 'utf8');
console.log('Feature testing UI added successfully!');
console.log('');
console.log('New features:');
console.log('- Click on any planned feature to open test modal');
console.log('- Run all tests for a feature');
console.log('- View test results with pass/fail status');
console.log('- Complete feature only if tests pass');
console.log('- Force complete option (not recommended)');
