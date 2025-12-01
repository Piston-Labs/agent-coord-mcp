with open('web/index.html', 'r', encoding='utf-8') as f:
    content = f.read()

changes = 0

# Fix 1: Remove display:none from telemetry grid - it should be visible by default
old_grid = '<div class="telemetry-grid" id="telemetryGrid" style="display: none;">'
new_grid = '<div class="telemetry-grid" id="telemetryGrid">'

if old_grid in content:
    content = content.replace(old_grid, new_grid)
    print('Fixed: Removed display:none from telemetryGrid')
    changes += 1

# Fix 2: Make sure both grid and list are visible (we want to show BOTH)
# The table should be below the device cards, not an either/or toggle
# Let's check if deviceListContainer has any inline display:none
if 'id="deviceListContainer" style="display: none' in content:
    content = content.replace('id="deviceListContainer" style="display: none', 'id="deviceListContainer" style="display: block')
    print('Fixed: Made deviceListContainer visible')
    changes += 1

# Fix 3: Update the CSS for device-list-container to have proper height
old_css = '''.device-list-container {
      background: var(--bg-secondary);
      border-radius: 8px;
      margin-bottom: 16px;
      border: 2px solid var(--accent);
      margin-top: 20px;'''

new_css = '''.device-list-container {
      background: var(--bg-secondary);
      border-radius: 8px;
      margin-bottom: 16px;
      border: 2px solid var(--accent);
      margin-top: 20px;
      min-height: 200px;
      overflow: visible;'''

if old_css in content:
    content = content.replace(old_css, new_css)
    print('Fixed: Added min-height to device-list-container')
    changes += 1

# Fix 4: Make telemetry-grid visible in CSS
old_telemetry_css = '''.telemetry-grid {
      flex: 1;
      display: grid;'''

new_telemetry_css = '''.telemetry-grid {
      flex: 1;
      display: grid !important;'''

if old_telemetry_css in content:
    content = content.replace(old_telemetry_css, new_telemetry_css)
    print('Fixed: Made telemetry-grid display:grid important')
    changes += 1

# Fix 5: The telemetryView tab-content needs to have overflow:auto to allow scrolling
old_tab = '''      <!-- Telemetry View -->
      <div class="tab-content" id="telemetryView">'''

new_tab = '''      <!-- Telemetry View -->
      <div class="tab-content" id="telemetryView" style="overflow-y: auto;">'''

if old_tab in content:
    content = content.replace(old_tab, new_tab)
    print('Fixed: Added overflow-y:auto to telemetryView')
    changes += 1

with open('web/index.html', 'w', encoding='utf-8') as f:
    f.write(content)

print(f'Done! Made {changes} changes.')
