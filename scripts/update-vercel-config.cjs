const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'vercel.json');
const config = {
  "version": 2,
  "buildCommand": "npm run build",
  "outputDirectory": "web",
  "functions": {
    "api/**/*.ts": {
      "runtime": "@vercel/node@3.0.0"
    }
  }
};

fs.writeFileSync(filePath, JSON.stringify(config, null, 2) + '\n', 'utf8');
console.log('Updated vercel.json');
