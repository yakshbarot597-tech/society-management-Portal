const tests = [
  '{"flats": [3 3 3]}',
  '{"flats": [3, 03, 3]}',
  '{"blocks": 03}',
  '{"phone": 98765 43210}',
  '{"phone": 09876543210}',
  '{"flats": [3,3,3], "default_due_day": 01}'
];

tests.forEach((t, i) => {
  try {
    JSON.parse(t);
    console.log(`Test ${i} passed: ${t}`);
  } catch (e) {
    console.log(`Test ${i} failed: "${t}" ===> ${e.message}`);
  }
});
