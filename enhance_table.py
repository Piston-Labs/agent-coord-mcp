import re

with open('web/index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Update table headers
old_headers = '''            <thead>
              <tr>
                <th onclick="sortDeviceListBy('imei')">IMEI ↕</th>
                <th onclick="sortDeviceListBy('vin')">VIN ↕</th>
                <th onclick="sortDeviceListBy('name')">Vehicle ↕</th>
                <th onclick="sortDeviceListBy('status')">Status</th>
                <th onclick="sortDeviceListBy('health')">Health ↕</th>
                <th>Last Seen</th>
                <th>Actions</th>
              </tr>
            </thead>'''

new_headers = '''            <thead>
              <tr>
                <th onclick="sortDeviceListBy('imei')">IMEI ↕</th>
                <th onclick="sortDeviceListBy('name')">Vehicle ↕</th>
                <th onclick="sortDeviceListBy('status')">Status</th>
                <th onclick="sortDeviceListBy('speed')">Speed ↕</th>
                <th onclick="sortDeviceListBy('battery')">Battery ↕</th>
                <th>Location</th>
                <th onclick="sortDeviceListBy('health')">Health ↕</th>
                <th>Last Seen</th>
              </tr>
            </thead>'''

if old_headers in content:
    content = content.replace(old_headers, new_headers)
    print('Updated table headers')
else:
    print('Could not find table headers')

# Update table row rendering
old_row = '''      tbody.innerHTML = sorted.map(device => {
        const vehicle = device.vehicleInfo || {};
        const vehicleStr = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'Unknown';
        const health = device.health || { score: 100, status: 'excellent' };
        const isMoving = device.status?.movement;
        const lastSeen = device.connectivity?.lastSeen ? formatTimeAgo(new Date(device.connectivity.lastSeen)) : '--';
        const statusClass = isMoving ? 'moving' : 'parked';
        const statusText = isMoving ? 'Moving' : 'Parked';

        return `
          <tr onclick="openDeviceModal('${device.imei}')" style="cursor: pointer;">
            <td class="imei-cell">${device.imei || '--'}</td>
            <td class="vin-cell">${vehicle.vin || 'N/A'}</td>
            <td class="vehicle-cell">${vehicleStr}</td>
            <td><span class="status-badge ${statusClass}">${statusText}</span></td>
            <td><span class="health-score ${health.status}">${health.score}%</span></td>
            <td>${lastSeen}</td>
            <td><button class="action-btn" onclick="event.stopPropagation(); openDeviceModal('${device.imei}')">Details</button></td>
          </tr>
        `;
      }).join('');'''

new_row = '''      tbody.innerHTML = sorted.map(device => {
        const vehicle = device.vehicleInfo || {};
        const vehicleStr = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'Unknown';
        const health = device.health || { score: 100, status: 'excellent' };
        const isMoving = device.status?.movement;
        const lastSeen = device.connectivity?.lastSeen ? formatTimeAgo(new Date(device.connectivity.lastSeen)) : '--';
        const statusClass = isMoving ? 'moving' : 'parked';
        const statusText = isMoving ? 'Moving' : 'Parked';
        const speed = device.metrics?.speed || 0;
        const battery = device.metrics?.batteryVoltage || '--';
        const lat = device.position?.lat?.toFixed(4) || '--';
        const lng = device.position?.lng?.toFixed(4) || '--';
        const batteryClass = battery >= 12.4 ? 'good' : battery >= 11.8 ? 'warn' : battery < 11.8 ? 'low' : '';

        return `
          <tr onclick="openDeviceModal('${device.imei}')" style="cursor: pointer;">
            <td class="imei-cell">${device.imei || '--'}</td>
            <td class="vehicle-cell">${vehicleStr}</td>
            <td><span class="status-badge ${statusClass}">${statusText}</span></td>
            <td class="speed-cell">${speed} <span class="unit">km/h</span></td>
            <td class="battery-cell ${batteryClass}">${battery}V</td>
            <td class="location-cell">${lat}, ${lng}</td>
            <td><span class="health-score ${health.status}">${health.score}%</span></td>
            <td class="time-cell">${lastSeen}</td>
          </tr>
        `;
      }).join('');'''

if old_row in content:
    content = content.replace(old_row, new_row)
    print('Updated table row rendering')
else:
    print('Could not find table row rendering')

# Update colspan for loading row
content = content.replace('colspan="7"', 'colspan="8"')
print('Updated colspan')

# Add sorting cases for new columns
old_sort = '''          case 'status':
            aVal = a.status?.movement ? 1 : 0;
            bVal = b.status?.movement ? 1 : 0;
            break;
          default:'''

new_sort = '''          case 'status':
            aVal = a.status?.movement ? 1 : 0;
            bVal = b.status?.movement ? 1 : 0;
            break;
          case 'speed':
            aVal = a.metrics?.speed || 0;
            bVal = b.metrics?.speed || 0;
            break;
          case 'battery':
            aVal = a.metrics?.batteryVoltage || 0;
            bVal = b.metrics?.batteryVoltage || 0;
            break;
          default:'''

if old_sort in content:
    content = content.replace(old_sort, new_sort)
    print('Updated sorting logic')
else:
    print('Could not find sorting logic')

with open('web/index.html', 'w', encoding='utf-8') as f:
    f.write(content)

print('Done!')
