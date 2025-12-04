import re

with open('web/index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Find the tbody.innerHTML section using regex
pattern = r"(tbody\.innerHTML = sorted\.map\(device => \{[\s\S]*?const statusText = isMoving \? 'Moving' : 'Parked';)\s*\n\s*return `"

replacement = r'''\1
        const speed = device.metrics?.speed || 0;
        const battery = device.metrics?.batteryVoltage || '--';
        const lat = device.position?.lat?.toFixed(4) || '--';
        const lng = device.position?.lng?.toFixed(4) || '--';
        const batteryClass = typeof battery === 'number' ? (battery >= 12.4 ? 'good' : battery >= 11.8 ? 'warn' : 'low') : '';

        return `'''

if re.search(pattern, content):
    content = re.sub(pattern, replacement, content)
    print('Added new variables')
else:
    print('Could not find pattern for variables')

# Now update the table row template
old_row = '''<tr onclick="openDeviceModal('${device.imei}')" style="cursor: pointer;">
            <td class="imei-cell">${device.imei || '--'}</td>
            <td class="vin-cell">${vehicle.vin || 'N/A'}</td>
            <td class="vehicle-cell">${vehicleStr}</td>
            <td><span class="status-badge ${statusClass}">${statusText}</span></td>
            <td><span class="health-score ${health.status}">${health.score}%</span></td>
            <td>${lastSeen}</td>
            <td><button class="action-btn" onclick="event.stopPropagation(); openDeviceModal('${device.imei}')">Details</button></td>
          </tr>'''

new_row = '''<tr onclick="openDeviceModal('${device.imei}')" style="cursor: pointer;">
            <td class="imei-cell">${device.imei || '--'}</td>
            <td class="vehicle-cell">${vehicleStr}</td>
            <td><span class="status-badge ${statusClass}">${statusText}</span></td>
            <td class="speed-cell">${speed} <span class="unit">km/h</span></td>
            <td class="battery-cell ${batteryClass}">${typeof battery === 'number' ? battery.toFixed(1) : battery}V</td>
            <td class="location-cell">${lat}, ${lng}</td>
            <td><span class="health-score ${health.status}">${health.score}%</span></td>
            <td class="time-cell">${lastSeen}</td>
          </tr>'''

if old_row in content:
    content = content.replace(old_row, new_row)
    print('Updated row template')
else:
    print('Could not find row template, trying flexible match...')
    # Try a more flexible approach
    row_pattern = r"<tr onclick=\"openDeviceModal\('\$\{device\.imei\}'\)\" style=\"cursor: pointer;\">[\s\S]*?</tr>"
    match = re.search(row_pattern, content)
    if match:
        print(f'Found row at {match.start()}, replacing...')
        content = content[:match.start()] + new_row + content[match.end():]
        print('Replaced row template')

with open('web/index.html', 'w', encoding='utf-8') as f:
    f.write(content)

print('Done!')
