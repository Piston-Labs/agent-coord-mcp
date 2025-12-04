with open('web/index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Add a bright border to make the table more visible
old_css = '''.device-list-container {
      background: var(--bg-secondary);
      border-radius: 8px;
      margin-bottom: 16px;'''

new_css = '''.device-list-container {
      background: var(--bg-secondary);
      border-radius: 8px;
      margin-bottom: 16px;
      border: 2px solid var(--accent);
      margin-top: 20px;'''

if old_css in content:
    content = content.replace(old_css, new_css)
    with open('web/index.html', 'w', encoding='utf-8') as f:
        f.write(content)
    print('Added highlight border to table')
else:
    print('Pattern not found')
