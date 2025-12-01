import re

with open('web/index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Find and replace the tbody.innerHTML section
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
        const batteryClass = battery >= 12.4 ? 'good' : battery >= 11.8 ? 'warn' : 'low';

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
    with open('web/index.html', 'w', encoding='utf-8') as f:
        f.write(content)
    print('Updated table row rendering!')
else:
    print('Could not find exact pattern, searching...')
    # Try to find what's there
    if 'tbody.innerHTML = sorted.map(device =>' in content:
        print('Found tbody.innerHTML but pattern differs')
        # Let's try regex
        pattern = r"tbody\.innerHTML = sorted\.map\(device => \{[\s\S]*?\}\.join\(''\);"
        match = re.search(pattern, content)
        if match:
            print(f'Found at position {match.start()}-{match.end()}')
            print('First 200 chars:', match.group(0)[:200])
