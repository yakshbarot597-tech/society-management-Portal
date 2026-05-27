const http = require('http');

const options = {
  hostname: 'localhost',
  port: 5000,
  path: '/api/society-flats/12-test/flat',
  method: 'GET',
  headers: {
    'x-api-key': 'hms-api-key-2024-secure',
    'accept': 'application/json'
  }
};

const req = http.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  res.on('end', () => {
    console.log('Status Code:', res.statusCode);
    const parsed = JSON.parse(data);
    console.log('Success:', parsed.success);
    console.log('Keys in Response:', Object.keys(parsed));
    if (parsed.config) {
      console.log('Config Keys:', Object.keys(parsed.config));
    }
  });
});

req.on('error', (e) => {
  console.error(`Problem with request: ${e.message}`);
});

req.end();
