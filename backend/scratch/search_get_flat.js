const fs = require('fs');
const server = fs.readFileSync('server.js', 'utf8');
const lines = server.split('\n');
lines.forEach((line, idx) => {
  if (line.includes('/api/flat')) {
    console.log(`${idx + 1}: ${line.trim()}`);
  }
});
