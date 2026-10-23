import test from 'node:test';
import assert from 'node:assert/strict';
import { runCommand } from '../src/exec.mjs';

test('commands get a writable npm cache even when HOME is unavailable', async () => {
  const result = await runCommand(`node -e 'const fs = require("node:fs"); const path = require("node:path"); const cache = process.env.npm_config_cache; fs.mkdirSync(cache, { recursive: true }); const probe = fs.mkdtempSync(path.join(cache, "probe-")); fs.rmdirSync(probe);'`, { env: { HOME: '/nonexistent' } });
  assert.equal(result.exitCode, 0, result.output);
});
