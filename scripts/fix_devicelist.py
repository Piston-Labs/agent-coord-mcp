with open('web/index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Add more debug logging after the sort and before innerHTML assignment
old_code = '''console.log('[DEVICELIST] tbody found, rendering...');

      if (!devices || devices.length === 0) {'''

new_code = '''console.log('[DEVICELIST] tbody found, rendering...');

      if (!devices || devices.length === 0) {
        console.log('[DEVICELIST] No devices, showing empty state');'''

if old_code in content:
    content = content.replace(old_code, new_code)
    print('Added empty state logging')

# Add logging after the sort
old_sort_end = '''return deviceListSortAsc ? aVal - bVal : bVal - aVal;
      });

      tbody.innerHTML = sorted.map(device => {'''

new_sort_end = '''return deviceListSortAsc ? aVal - bVal : bVal - aVal;
      });

      console.log('[DEVICELIST] Sorted', sorted.length, 'devices, first IMEI:', sorted[0]?.imei);

      try {
        tbody.innerHTML = sorted.map(device => {'''

if old_sort_end in content:
    content = content.replace(old_sort_end, new_sort_end)
    print('Added sort logging and try block')

# Find and wrap the end of the map with try-catch
old_map_end = '''}).join('');
    }

    function sortDeviceList() {'''

new_map_end = '''}).join('');
        console.log('[DEVICELIST] Successfully rendered table rows');
      } catch (err) {
        console.error('[DEVICELIST] Error rendering rows:', err);
        tbody.innerHTML = '<tr><td colspan="8" class="loading-row">Error rendering devices</td></tr>';
      }
    }

    function sortDeviceList() {'''

if old_map_end in content:
    content = content.replace(old_map_end, new_map_end)
    print('Added try-catch and success logging')

with open('web/index.html', 'w', encoding='utf-8') as f:
    f.write(content)

print('Done!')
