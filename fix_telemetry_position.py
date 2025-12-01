with open('web/index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# The telemetryView is outside the main panel. We need to move it inside.
# Current structure (broken):
#   </div>  <- closes metricsView
#
#   </div>  <- closes main panel (line 5713)
#
#   <!-- Context Panel - Enhanced -->
#
#     <!-- Telemetry View -->
#     <div class="tab-content" id="telemetryView"...>
#       ... telemetry content ...
#     </div>
#   <div class="panel">  <- context panel starts

# We need to find where telemetryView starts and ends, cut it, and paste it before line 5713

# First, let's find the telemetryView section
telemetry_start_marker = '''    <!-- Context Panel - Enhanced -->

      <!-- Telemetry View -->
      <div class="tab-content" id="telemetryView" style="overflow-y: auto;">'''

# Find where telemetryView ends (before the context panel div)
telemetry_end_marker = '''      </div>
    <div class="panel">
      <div class="panel-header">
        <span>Active Context</span>'''

if telemetry_start_marker in content and telemetry_end_marker in content:
    # Get position of markers
    start_pos = content.find(telemetry_start_marker)
    end_pos = content.find(telemetry_end_marker)

    if start_pos < end_pos:
        # Extract the telemetry view content (without the Context Panel comment and the ending panel div)
        telemetry_start = content.find('<div class="tab-content" id="telemetryView"', start_pos)
        telemetry_content_end = content.find('</div>\n    <div class="panel">', telemetry_start)

        # Get the telemetry content including its closing div
        telemetry_section = content[telemetry_start:telemetry_content_end + 6]  # +6 for </div>

        print(f"Found telemetry section: {len(telemetry_section)} chars")
        print(f"Start: {telemetry_section[:100]}...")

        # Now we need to:
        # 1. Remove the telemetry section from its current position
        # 2. Insert it before the closing </div> of the main panel

        # Find the pattern where metricsView ends and main panel closes
        old_pattern = '''      </div>

    </div>

    <!-- Context Panel - Enhanced -->

      <!-- Telemetry View -->'''

        new_pattern = '''      </div>

      <!-- Telemetry View -->'''

        if old_pattern in content:
            content = content.replace(old_pattern, new_pattern)
            print("Moved telemetry comment up")

        # Now move the closing </div> of main panel after telemetryView
        old_close = '''    </div>

    <!-- Context Panel - Enhanced -->

      <!-- Telemetry View -->
      <div class="tab-content" id="telemetryView"'''

        # Actually let's do this more carefully - just fix the </div> positioning
        # The issue is there's an extra </div> before telemetryView

        # Let me try a different approach - find and fix the structure
        print("Trying alternative fix...")

with open('web/index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# More targeted fix: The problem is the </div> on line 5713 closes the main panel too early
# We need to move telemetryView BEFORE that closing div

# Pattern: metricsView closes, then main panel closes, then telemetryView is outside
broken_structure = '''      </div>

    </div>

    <!-- Context Panel - Enhanced -->

      <!-- Telemetry View -->
      <div class="tab-content" id="telemetryView" style="overflow-y: auto;">'''

# We want: metricsView closes, then telemetryView, then main panel closes
# First part of fix - move the comment and telemetryView start before the panel close
fixed_structure = '''      </div>

      <!-- Telemetry View -->
      <div class="tab-content" id="telemetryView" style="overflow-y: auto;">'''

if broken_structure in content:
    content = content.replace(broken_structure, fixed_structure)
    print("Step 1: Moved telemetry inside panel")
else:
    print("Step 1 pattern not found")

# Now we need to find where telemetryView ends and add the panel closing div after it
# and remove the orphaned </div> that was closing the panel early

# Find the end of telemetryView (right before context panel starts)
old_end = '''        </div>
      </div>
    <div class="panel">
      <div class="panel-header">
        <span>Active Context</span>'''

new_end = '''        </div>
      </div>

    </div>

    <!-- Context Panel -->
    <div class="panel">
      <div class="panel-header">
        <span>Active Context</span>'''

if old_end in content:
    content = content.replace(old_end, new_end)
    print("Step 2: Fixed panel closing after telemetryView")
else:
    print("Step 2 pattern not found, trying alternative...")
    # Try to find the pattern
    alt_old = '''      </div>
    <div class="panel">
      <div class="panel-header">
        <span>Active Context</span>'''

    alt_new = '''      </div>

    </div>

    <!-- Context Panel -->
    <div class="panel">
      <div class="panel-header">
        <span>Active Context</span>'''

    if alt_old in content:
        content = content.replace(alt_old, alt_new, 1)
        print("Step 2 alt: Added panel closing before context panel")

with open('web/index.html', 'w', encoding='utf-8') as f:
    f.write(content)

print("Done!")
