import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, "..");

function parseEnv(content) {
  const env = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

async function loadConfig() {
  const configPath = join(PROJECT_ROOT, "config.json");
  const configContent = await readFile(configPath, "utf-8");
  const config = JSON.parse(configContent);

  const envPath = join(PROJECT_ROOT, ".env");
  let env = {};
  try {
    const envContent = await readFile(envPath, "utf-8");
    env = parseEnv(envContent);
  } catch {
    // .env is optional; ignore if missing
  }

  // Merge: config.json values can be overridden by .env file, then by process.env
  const merged = { ...config };
  if (env.BART_API_KEY) merged.bartApiKey = env.BART_API_KEY;
  if (env.API_511_KEY) merged.api511Key = env.API_511_KEY;
  // process.env takes highest precedence
  if (process.env.BART_API_KEY) merged.bartApiKey = process.env.BART_API_KEY;
  if (process.env.API_511_KEY) merged.api511Key = process.env.API_511_KEY;

  return merged;
}

let cachedConfig = null;

export async function getConfig() {
  if (!cachedConfig) {
    cachedConfig = await loadConfig();
  }
  return cachedConfig;
}

export function resetConfigCache() {
  cachedConfig = null;
}
