const fs = require('fs');

let content = fs.readFileSync('api/chat.ts', 'utf8');

const old = `const { author, authorType = 'agent', message } = req.body;

      if (!author || !message) {
        return res.status(400).json({ error: 'author and message required' });
      }

      const newMessage = {`;

const replacement = `const { author, authorType = 'agent', message, imageData, imageName } = req.body;

      if (!author || (!message && !imageData)) {
        return res.status(400).json({ error: 'author and (message or imageData) required' });
      }

      // Validate image if provided (max 500KB base64)
      if (imageData) {
        if (typeof imageData !== 'string' || imageData.length > 700000) {
          return res.status(400).json({ error: 'Image too large (max 500KB)' });
        }
        if (!imageData.startsWith('data:image/')) {
          return res.status(400).json({ error: 'Invalid image format. Must be base64 data URL' });
        }
      }

      const newMessage: Record<string, any> = {`;

if (content.includes(old)) {
  content = content.replace(old, replacement);
  fs.writeFileSync('api/chat.ts', content);
  console.log('SUCCESS: Updated chat.ts with image support');
} else {
  console.log('ERROR: Target string not found');
}
