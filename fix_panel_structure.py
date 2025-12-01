with open('web/index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# The problem is an extra </div> after roadmapView that closes the panel too early
# This causes metricsView and telemetryView to be outside the panel

# Pattern: roadmapView closes, then panel closes (wrong), then metricsView
broken = '''          </div>
        </div>
      </div>
    </div>



      <!-- Metrics View -->
      <div class="tab-content" id="metricsView">'''

# Fix: roadmapView closes, metricsView starts (still inside panel)
fixed = '''          </div>
        </div>
      </div>

      <!-- Metrics View -->
      <div class="tab-content" id="metricsView">'''

if broken in content:
    content = content.replace(broken, fixed)
    print("Fixed: Removed extra </div> that was closing panel early")
else:
    print("Pattern not found, checking alternative...")
    # Try with different whitespace
    import re
    # Look for the pattern more flexibly
    pattern = r'(</div>\s*</div>\s*</div>)\s*(</div>)\s*\n*\s*<!-- Metrics View -->'
    match = re.search(pattern, content)
    if match:
        print(f"Found pattern at position {match.start()}")
        # Replace removing the extra </div>
        old = match.group(0)
        new = match.group(1) + '\n\n      <!-- Metrics View -->'
        content = content.replace(old, new)
        print("Fixed with regex")

with open('web/index.html', 'w', encoding='utf-8') as f:
    f.write(content)

print("Done!")
