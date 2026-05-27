const fs = require('fs');
const script = fs.readFileSync('script.js', 'utf8');
const lines = script.split('\n');
lines.forEach((line, idx) => {
  if (line.includes('fetch(') || line.includes('api/')) {
    console.log(`${idx + 1}: ${line.trim()}`);
  }
});
