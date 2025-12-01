with open('web/index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Add debug logging to renderDeviceList
old_render = '''function renderDeviceList(devices) {
      const tbody = document.getElementById('deviceListBody');
      if (!tbody) return;'''

new_render = '''function renderDeviceList(devices) {
      console.log('[DEVICELIST] renderDeviceList called with', devices?.length || 0, 'devices');
      const tbody = document.getElementById('deviceListBody');
      if (!tbody) {
        console.error('[DEVICELIST] tbody not found!');
        return;
      }
      console.log('[DEVICELIST] tbody found, rendering...');'''

if old_render in content:
    content = content.replace(old_render, new_render)
    print('Added debug logging to renderDeviceList')
else:
    print('Could not find renderDeviceList')

# Also add logging to renderTelemetryGrid
old_grid = '''function renderTelemetryGrid(devices) {
      const grid = document.getElementById('telemetryGrid');
      currentTelemetryData = devices || [];'''

new_grid = '''function renderTelemetryGrid(devices) {
      console.log('[TELEMETRY] renderTelemetryGrid called with', devices?.length || 0, 'devices');
      const grid = document.getElementById('telemetryGrid');
      currentTelemetryData = devices || [];'''

if old_grid in content:
    content = content.replace(old_grid, new_grid)
    print('Added debug logging to renderTelemetryGrid')
else:
    print('Could not find renderTelemetryGrid')

with open('web/index.html', 'w', encoding='utf-8') as f:
    f.write(content)

print('Done!')
