/**
 * The RuntimeAdapter contract.
 *
 * Decision 22 requires full Codex parity, and Codex has no session registry to
 * read liveness from. So an adapter owns more than spawn-and-stream: it must
 * also parse its own transcript format and derive status from it. Those are
 * required methods from the first implementation, not Claude-specific helpers
 * that a second runtime later borrows.
 *
 * The UI renders from `capabilities`, so a runtime that cannot do something
 * shows the feature as unavailable rather than showing a broken one.
 */

/**
 * @typedef {object} RuntimeCapabilities
 * @property {boolean} spawn        can start a session
 * @property {boolean} streamInput  can accept follow-up messages without respawn
 * @property {boolean} interrupt    can be stopped mid-turn and survive
 * @property {boolean} resume       can continue a previous session by id
 * @property {boolean} fork         can branch a session into a new id
 * @property {boolean} registry     publishes live processes for foreign discovery
 * @property {boolean} gates        supports a pre-tool permission gate
 * @property {boolean} reportedCost emits its own cost figure, so cost is measured
 * @property {boolean} harness      skills, hooks and memory apply to it
 */

/**
 * @typedef {object} RuntimeAdapter
 * @property {string} id
 * @property {string} label
 * @property {RuntimeCapabilities} capabilities
 * @property {(opts: object) => object} buildSpawn   argv + env + cwd for a run
 * @property {(line: string) => object|null} parseEvent  one stdout line -> normalised event
 * @property {(text: string) => string} encodeInput  a user message -> a stdin line
 * @property {(acc: object, live: object|null, now?: number) => string} deriveStatus
 * @property {(file: string, id: string) => Promise<object>} parseTranscript
 */

/** Normalised event kinds every adapter emits, whatever its wire format. */
export const EVENT = {
  INIT: "init",
  TEXT: "text",
  THINKING: "thinking",
  TOOL_USE: "tool_use",
  TOOL_RESULT: "tool_result",
  PARTIAL: "partial",
  STATUS: "status",
  HOOK: "hook",
  RATE_LIMIT: "rate_limit",
  RESULT: "result",
  ERROR: "error",
};

const registry = new Map();

export function registerRuntime(adapter) {
  for (const m of ["buildSpawn", "parseEvent", "encodeInput", "deriveStatus", "parseTranscript"]) {
    if (typeof adapter[m] !== "function") {
      throw new Error(`runtime "${adapter.id}" is missing required method ${m}()`);
    }
  }
  registry.set(adapter.id, adapter);
  return adapter;
}

export const getRuntime = (id) => registry.get(id) ?? null;
export const listRuntimes = () => [...registry.values()];
