// posey-tube client: communicates with the posey-tube GPIO gateway
// The browser never talks to posey-tube directly; this backend proxies requests.

import { getConfig } from "../config.js";

const POSEY_TIMEOUT_MS = 2000; // 2 second timeout per requirements

export class PoseyClient {
  constructor(baseUrl, token) {
    this.baseUrl = baseUrl.replace(/\/$/, ""); // strip trailing slash
    this.token = token;
  }

  static async create() {
    const config = await getConfig();
    if (!config.poseyTubeUrl || !config.poseyTubeToken) {
      return null; // feature disabled
    }
    return new PoseyClient(config.poseyTubeUrl, config.poseyTubeToken);
  }

  get enabled() {
    return !!this.baseUrl && !!this.token;
  }

  // Internal: make a request to posey-tube with timeout and auth
  async request(method, path, body = null) {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), POSEY_TIMEOUT_MS);

    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.token}`,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        // Pass through posey-tube error status
        const text = await res.text().catch(() => "");
        const error = new Error(text || `posey-tube error: ${res.status}`);
        error.status = res.status;
        throw error;
      }

      if (method === "DELETE" || res.status === 204) {
        return null;
      }

      return res.json();
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === "AbortError" || err.name === "TimeoutError") {
        const error = new Error("posey-tube offline");
        error.status = 503;
        throw error;
      }
      const causeCode = err.cause?.code || err.code;
      if (causeCode === "ECONNREFUSED" || causeCode === "ENOTFOUND") {
        const error = new Error("posey-tube offline");
        error.status = 503;
        throw error;
      }
      throw err;
    }
  }

  // GET /pins - list all pins
  async listPins() {
    return this.request("GET", "/pins");
  }

  // GET /pins/:name - get single pin (we'll filter client-side for now)
  async getPin(name) {
    const pins = await this.listPins();
    return pins.find((p) => p.name === name) || null;
  }

  // POST /pins/:name with { on: bool } | { pulse_ms: n } | { enabled: bool }
  async setPin(name, body) {
    return this.request("POST", `/pins/${encodeURIComponent(name)}`, body);
  }
}

// PIN-code plumbing: hook for future PIN check on write routes
// Returns true to allow, or throws 403 to deny
export async function authorizeControl(req) {
  // TODO: Implement PIN check here when GPIO_CONTROL_PIN is configured
  // For now, always allow. Reserved config: GPIO_CONTROL_PIN (not used yet).
  return true;
}

export function isPoseyEnabled(config) {
  return !!config.poseyTubeUrl && !!config.poseyTubeToken;
}