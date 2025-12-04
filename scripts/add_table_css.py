with open('web/index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# CSS for new table cells
new_css = '''
    /* Enhanced table cell styles */
    .speed-cell {
      font-family: 'Monaco', 'Consolas', monospace;
      font-weight: 600;
      color: #4ade80;
    }
    .speed-cell .unit {
      font-size: 0.75rem;
      color: rgba(255,255,255,0.5);
      font-weight: 400;
    }
    .battery-cell {
      font-family: 'Monaco', 'Consolas', monospace;
      font-weight: 600;
    }
    .battery-cell.good { color: #4ade80; }
    .battery-cell.warn { color: #fbbf24; }
    .battery-cell.low { color: #f87171; }
    .location-cell {
      font-family: 'Monaco', 'Consolas', monospace;
      font-size: 0.8rem;
      color: rgba(255,255,255,0.7);
    }
    .time-cell {
      color: rgba(255,255,255,0.6);
      font-size: 0.85rem;
    }
    .imei-cell {
      font-family: 'Monaco', 'Consolas', monospace;
      font-size: 0.85rem;
      color: #60a5fa;
    }
    .vehicle-cell {
      font-weight: 500;
    }
'''

# Find a good place to insert the CSS - after existing table styles
if '.device-table th' in content:
    # Insert after existing table styles
    insert_point = content.find('.device-table th')
    # Find the end of that rule
    brace_count = 0
    i = insert_point
    while i < len(content):
        if content[i] == '{':
            brace_count += 1
        elif content[i] == '}':
            brace_count -= 1
            if brace_count == 0:
                # Find the next closing brace (end of th rule)
                i += 1
                break
        i += 1

    # Insert after the rule
    content = content[:i] + new_css + content[i:]
    print('Added table cell CSS')
else:
    print('Could not find table styles, adding to end of style section')
    # Find </style> and insert before it
    insert_point = content.rfind('</style>')
    if insert_point > 0:
        content = content[:insert_point] + new_css + '\n    ' + content[insert_point:]
        print('Added CSS before </style>')

with open('web/index.html', 'w', encoding='utf-8') as f:
    f.write(content)

print('Done!')
