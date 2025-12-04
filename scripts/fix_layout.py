with open('web/index.html', 'r', encoding='utf-8') as f:
    content = f.read()

changes = 0

# The telemetryView needs better layout styling
# Let's add explicit styles to make content visible

# Fix the tab-content overflow issue - it's set to overflow:hidden in multiple places
old_tab_overflow = '''    .tab-content {
      display: none;
      flex: 1;
      flex-direction: column;
      min-height: 0;
      overflow: hidden;
    }'''

new_tab_overflow = '''    .tab-content {
      display: none;
      flex: 1;
      flex-direction: column;
      min-height: 0;
      overflow-y: auto;
    }'''

if old_tab_overflow in content:
    content = content.replace(old_tab_overflow, new_tab_overflow)
    print('Fixed: Changed tab-content overflow from hidden to auto')
    changes += 1

# Fix the other tab-content override
old_active = '''      .tab-content.active {
        display: flex;
        flex-direction: column;
        flex: 1;
        overflow: hidden;
      }'''

new_active = '''      .tab-content.active {
        display: flex;
        flex-direction: column;
        flex: 1;
        overflow-y: auto;
      }'''

if old_active in content:
    content = content.replace(old_active, new_active)
    print('Fixed: Changed tab-content.active overflow from hidden to auto')
    changes += 1

# The telemetry-grid and device-list need proper dimensions
# Add CSS to make them expand properly
additional_css = '''
    /* Telemetry content visibility fixes */
    #telemetryView {
      overflow-y: auto !important;
      padding: 16px;
    }

    #telemetryView .telemetry-grid {
      display: grid !important;
      min-height: 300px;
      margin-bottom: 20px;
    }

    #telemetryView .device-list-container {
      display: block !important;
      min-height: 200px;
      margin-bottom: 20px;
    }

    /* Make sure health overview doesn't take all space */
    .health-overview {
      max-height: 300px;
      overflow-y: auto;
      margin-bottom: 20px;
    }
'''

# Insert before the closing </style> tag
style_close = '</style>'
if style_close in content:
    content = content.replace(style_close, additional_css + '\n    ' + style_close, 1)
    print('Added: Telemetry visibility CSS fixes')
    changes += 1

with open('web/index.html', 'w', encoding='utf-8') as f:
    f.write(content)

print(f'Done! Made {changes} changes.')
