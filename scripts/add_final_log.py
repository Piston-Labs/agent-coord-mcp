import re

with open('web/index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Use regex to match the pattern with flexible whitespace
pattern = r"(\}\)\.join\(''\);)\s*(\n\s*\})\s*(\n\s*function sortDeviceList\(\) \{)"
replacement = r"\1\n      console.log('[DEVICELIST] innerHTML set, tbody now has', tbody.children.length, 'rows');\2\3"

new_content, count = re.subn(pattern, replacement, content)

if count > 0:
    with open('web/index.html', 'w', encoding='utf-8') as f:
        f.write(new_content)
    print(f'Added final log ({count} replacements)')
else:
    print('Pattern not found')
