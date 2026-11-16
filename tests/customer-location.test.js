const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
for (const page of ['user-profile', 'register']) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'pages', `${page}.js`), 'utf8');
  assert.doesNotMatch(source, /name=["'](?:location|address|postal)["']/i, `${page} must not collect customer location`);
  assert.doesNotMatch(source, /user\.location/, `${page} must not display customer location`);
}
console.log('Profile and registration do not collect or display customer location.');
