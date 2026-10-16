const fs = require('node:fs');
const path = require('node:path');

const backendUrl = process.env.BACKEND_URL;
if (!backendUrl) {
  throw new Error('Set the BACKEND_URL environment variable to your deployed HTTPS backend URL.');
}

let parsedUrl;
try {
  parsedUrl = new URL(backendUrl);
} catch {
  throw new Error('BACKEND_URL must be a valid HTTPS URL, such as https://your-app.up.railway.app.');
}
if (parsedUrl.protocol !== 'https:' || parsedUrl.username || parsedUrl.password
  || parsedUrl.pathname !== '/' || parsedUrl.search || parsedUrl.hash) {
  throw new Error('BACKEND_URL must be an HTTPS origin without credentials, path, query, or hash.');
}

const root = path.join(__dirname, '..');
const publishDir = path.join(root, 'dist');
fs.rmSync(publishDir, { recursive: true, force: true });
fs.cpSync(path.join(root, 'public'), publishDir, { recursive: true });
fs.writeFileSync(
  path.join(publishDir, 'config.js'),
  `window.API_BASE = ${JSON.stringify(parsedUrl.origin)};\n`
);
console.log(`Built Netlify frontend for ${parsedUrl.origin}`);
