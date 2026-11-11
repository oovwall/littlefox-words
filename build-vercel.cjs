const fs = require('node:fs');
const path = require('node:path');

const publishableKey = process.env.CLERK_PUBLISHABLE_KEY?.trim();
if (!/^pk_(test|live)_[A-Za-z0-9+/=]+$/.test(publishableKey ?? '')) {
  throw new Error('Set CLERK_PUBLISHABLE_KEY in Vercel before deploying.');
}
fs.writeFileSync(path.join(__dirname, 'dist', 'clerk-config.json'), JSON.stringify({ publishableKey }));
