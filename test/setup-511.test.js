import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptUrl = new URL("../scripts/setup-511.mjs", import.meta.url);
const scriptPath = fileURLToPath(scriptUrl);

test("setup script explains the required API key", () => {
  const env = { ...process.env };
  delete env.API_511_KEY;

  const result = spawnSync(process.execPath, [scriptPath], {
    encoding: "utf8",
    env,
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /API_511_KEY environment variable is required/);
  assert.match(result.stderr, /Usage: API_511_KEY=your_key node scripts\/setup-511\.mjs/);
  assert.doesNotMatch(result.stderr, /SyntaxError|MODULE_NOT_FOUND/);
});
