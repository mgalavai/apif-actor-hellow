import { Actor } from 'apify';

await Actor.init();

// Read JSON input
const input = (await Actor.getInput()) ?? {};
const name = typeof input.name === 'string' && input.name.trim() ? input.name.trim() : 'world';
const repeat = Number.isFinite(input.repeat) ? Math.max(1, Math.min(50, input.repeat)) : 1;

// Create results
const results = Array.from({ length: repeat }, (_, i) => ({
  message: `Hello, ${name}! #${i + 1}`,
  ts: new Date().toISOString(),
  inputEcho: input.echoInput === true ? input : undefined,
}));

// Push to dataset (users can download JSON/CSV from runs)
await Actor.pushData(results);

// Also return a nice object in console logs
console.log(JSON.stringify({ ok: true, count: results.length }, null, 2));

await Actor.exit();
