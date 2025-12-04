#!/usr/bin/env python3
"""Update frontend to display offline devices correctly."""

with open('web/index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Update renderDeviceCard to handle offline devices
old_render = '''    function renderDeviceCard(device) {
      const isMoving = device.status?.movement;
      const ignitionOn = device.status?.ignition;
      const batteryClass = getBatteryClass(device.metrics?.batteryVoltage);
      const vehicle = device.vehicleInfo || {};
      const vehicleStr = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ');
      const health = device.health || { score: 100, status: 'excellent', issues: [] };
      const healthStatus = health.status || 'excellent';
      const healthIssue = health.issues?.[0] || 'All systems normal';
      const currentSpeed = device.metrics?.speed || 0;
      const speedHistory = device.speedHistory || Array(12).fill(0).map((_, i) =>
        Math.max(0, currentSpeed + (Math.random() - 0.5) * 20 - i * 2)
      ).reverse();
      const maxSpeed = Math.max(...speedHistory, 1);
      const lastSeen = device.connectivity?.lastSeen ? new Date(device.connectivity.lastSeen) : null;
      const lastSeenStr = lastSeen ? formatTimeAgo(lastSeen) : '--';
      const signalBars = device.connectivity?.signalStrength || 0;
      const carrier = device.connectivity?.carrier || 'Unknown';
      const fuelLevel = device.metrics?.fuelLevel || 0;
      const engineRPM = device.metrics?.engineRPM || 0;
      const coolantTemp = device.metrics?.coolantTemp || 0;
      const lat = device.position?.lat?.toFixed(4) || '--';
      const lng = device.position?.lng?.toFixed(4) || '--';
      const heading = device.position?.heading || 0;
      const satellites = device.position?.satellites || 0;

      return `
        <div class="device-card ${ignitionOn ? 'ignition-on' : 'ignition-off'} health-${healthStatus}" onclick="openDeviceModal('${device.imei}')" style="cursor:pointer">
          <div class="device-health-badge ${healthStatus === 'warning' ? 'warning' : healthStatus === 'critical' ? 'critical' : ''}"></div>
          <div class="device-header">
            <div class="device-title-row">
              <span class="device-name">${device.deviceName || 'Unknown'}</span>
              <span class="device-imei" title="IMEI">${device.imei}</span>
            </div>
            <span class="device-status ${isMoving ? 'moving' : 'parked'}">
              <span class="device-status-dot"></span>
              ${isMoving ? 'Moving' : 'Parked'}
            </span>
          </div>
          <div class="device-live-indicator">
            <span class="live-dot"></span>
            <span>Last seen: ${lastSeenStr}</span>
            <span class="signal-bars" title="${carrier} - ${signalBars}/5 bars">
              ${[1,2,3,4,5].map(i => '<span class="signal-bar ' + (i <= signalBars ? 'active' : '') + '"></span>').join('')}
            </span>
          </div>'''

new_render = '''    function renderDeviceCard(device) {
      const isOffline = device.status?.offline === true;
      const isMoving = !isOffline && device.status?.movement;
      const ignitionOn = !isOffline && device.status?.ignition;
      const batteryClass = isOffline ? '' : getBatteryClass(device.metrics?.batteryVoltage);
      const vehicle = device.vehicleInfo || {};
      const vehicleStr = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ');
      const health = device.health || { score: 100, status: 'excellent', issues: [] };
      const healthStatus = isOffline ? 'critical' : (health.status || 'excellent');
      const healthIssue = health.issues?.[0] || (isOffline ? 'Device offline' : 'All systems normal');
      const currentSpeed = device.metrics?.speed || 0;
      const speedHistory = device.speedHistory || Array(12).fill(0).map((_, i) =>
        Math.max(0, currentSpeed + (Math.random() - 0.5) * 20 - i * 2)
      ).reverse();
      const maxSpeed = Math.max(...speedHistory, 1);
      const lastSeen = device.connectivity?.lastSeen ? new Date(device.connectivity.lastSeen) : null;
      const lastSeenStr = lastSeen ? formatTimeAgo(lastSeen) : '--';
      const signalBars = device.connectivity?.signalStrength || 0;
      const carrier = device.connectivity?.carrier || 'Unknown';
      const fuelLevel = device.metrics?.fuelLevel || 0;
      const engineRPM = device.metrics?.engineRPM || 0;
      const coolantTemp = device.metrics?.coolantTemp || 0;
      const lat = device.position?.lat?.toFixed(4) || '--';
      const lng = device.position?.lng?.toFixed(4) || '--';
      const heading = device.position?.heading || 0;
      const satellites = device.position?.satellites || 0;

      // Determine status text and class
      const statusClass = isOffline ? 'offline' : (isMoving ? 'moving' : 'parked');
      const statusText = isOffline ? 'Offline' : (isMoving ? 'Moving' : 'Parked');
      const cardClass = isOffline ? 'device-offline' : (ignitionOn ? 'ignition-on' : 'ignition-off');

      return `
        <div class="device-card ${cardClass} health-${healthStatus}" onclick="openDeviceModal('${device.imei}')" style="cursor:pointer${isOffline ? ';opacity:0.7' : ''}">
          <div class="device-health-badge ${healthStatus === 'warning' ? 'warning' : healthStatus === 'critical' ? 'critical' : ''}"></div>
          <div class="device-header">
            <div class="device-title-row">
              <span class="device-name">${device.deviceName || 'Unknown'}</span>
              <span class="device-imei" title="IMEI">${device.imei}</span>
            </div>
            <span class="device-status ${statusClass}">
              <span class="device-status-dot"></span>
              ${statusText}
            </span>
          </div>
          <div class="device-live-indicator">
            <span class="live-dot${isOffline ? ' offline' : ''}"></span>
            <span>Last seen: ${lastSeenStr}</span>
            <span class="signal-bars" title="${isOffline ? 'No signal - offline' : carrier + ' - ' + signalBars + '/5 bars'}">
              ${[1,2,3,4,5].map(i => '<span class="signal-bar ' + (i <= signalBars ? 'active' : '') + '"></span>').join('')}
            </span>
          </div>'''

if old_render in content:
    content = content.replace(old_render, new_render)
    print('Updated renderDeviceCard to handle offline devices')
else:
    print('Could not find old renderDeviceCard pattern')

# Add CSS for offline status
old_parked_css = '''    .device-status.parked {
      background: rgba(139, 148, 158, 0.15);
      color: var(--text-secondary);
    }'''

new_parked_css = '''    .device-status.parked {
      background: rgba(139, 148, 158, 0.15);
      color: var(--text-secondary);
    }

    .device-status.offline {
      background: rgba(248, 81, 73, 0.15);
      color: var(--danger);
    }

    .device-card.device-offline {
      border-left: 4px solid var(--danger);
    }

    .live-dot.offline {
      background: var(--danger);
      animation: none;
    }'''

if old_parked_css in content:
    content = content.replace(old_parked_css, new_parked_css)
    print('Added CSS for offline status')

# Update table row to show offline status
old_table_row = '''            const statusClass = d.status?.movement ? 'moving' : 'parked';
            const statusText = d.status?.movement ? 'Moving' : 'Parked';'''

new_table_row = '''            const isDeviceOffline = d.status?.offline === true;
            const statusClass = isDeviceOffline ? 'offline' : (d.status?.movement ? 'moving' : 'parked');
            const statusText = isDeviceOffline ? 'Offline' : (d.status?.movement ? 'Moving' : 'Parked');'''

if old_table_row in content:
    content = content.replace(old_table_row, new_table_row)
    print('Updated table row to handle offline status')

with open('web/index.html', 'w', encoding='utf-8') as f:
    f.write(content)

print('Done!')
