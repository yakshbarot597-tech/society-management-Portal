const fs = require('fs');

const script = fs.readFileSync('script.js', 'utf8');
const server = fs.readFileSync('server.js', 'utf8');

console.log('--- Matches in script.js ---');
const scriptLines = script.split('\n');
scriptLines.forEach((line, idx) => {
  if (line.toLowerCase().includes('api-key') || line.toLowerCase().includes('apikey')) {
    console.log(`${idx + 1}: ${line.trim()}`);
  }
});

console.log('--- Matches in server.js ---');
const serverLines = server.split('\n');
serverLines.forEach((line, idx) => {
  if (line.toLowerCase().includes('api-key') || line.toLowerCase().includes('apikey')) {
    console.log(`${idx + 1}: ${line.trim()}`);
  }
});
