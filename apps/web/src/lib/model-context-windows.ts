const DEFAULT_CONTEXT_WINDOW = 200_000
const CONTEXT_1M = 1_000_000

/**
 * Models whose standard context window is 1M tokens, with no `[1m]` opt-in.
 *
 * Source: the model table inside Claude Code 2.1.321 (the desktop app's
 * bundled CLI), where each of these has `context:{window:1e6,native_1m:!0}`.
 * Models with a 200k window there (Opus 4.0–4.6, Sonnet 4.x, Haiku 4.5) are
 * left out on purpose: they reach 1M only with the `[1m]` opt-in, so for
 * them the fill-based guess below still applies.
 */
const NATIVE_1M_MODELS = new Set([
  'claude-opus-5-5',
  'claude-opus-5',
  'claude-opus-4-8',
  'claude-opus-4-7',
  'claude-sonnet-5-5',
  'claude-sonnet-5',
  'claude-haiku-5-5',
  'claude-fable-5-2',
  'claude-fable-5-1',
  'claude-fable-5',
  'claude-mythos-5-2',
  'claude-mythos-5-1',
  'claude-mythos-5',
])

/**
 * Normalise a model id for the table: drop a provider prefix
 * (`us.anthropic.`), a `[1m]`-style tag, a `-YYYYMMDD` date and a `-v1:0` /
 * `@date` suffix.
 */
function baseModelId(model: string): string {
  let m = model.trim().toLowerCase()
  const i = m.indexOf('claude-')
  if (i > 0) m = m.slice(i)
  m = m.replace(/\[[^\]]*\]$/, '')
  m = m.replace(/@.*$/, '')
  m = m.replace(/-v\d+(:\d+)?$/, '')
  m = m.replace(/-\d{8}$/, '')
  return m
}

/**
 * The model's standard context window when it is known from Claude Code's
 * own model table, else null.
 */
export function knownContextWindow(model?: string | null): number | null {
  if (!model) return null
  return NATIVE_1M_MODELS.has(baseModelId(model)) ? CONTEXT_1M : null
}

/**
 * Returns the context window limit for a model.
 *
 * Priority order:
 * 1. `statuslineSize` — authoritative value from Claude Code's statusline JSON
 *    (context_window.context_window_size). Always correct, knows 1M from turn 1.
 * 2. The model's window from Claude Code's model table (`knownContextWindow`).
 * 3. A `[1m]` / `context-1m` marker on the model id: 1M.
 * 4. Infer from `currentFill` — if fill exceeds 200K the session must be 1M
 *    (only for models whose window is not known).
 * 5. Default 200K.
 */
export function getContextLimit(
  model?: string | null,
  currentFill?: number,
  statuslineSize?: number | null,
): number {
  if (statuslineSize != null && statuslineSize > 0) return statuslineSize
  const known = knownContextWindow(model)
  if (known != null) return known
  if (model && /\[1m\]|context-1m/i.test(model)) return CONTEXT_1M
  if (currentFill != null && currentFill > DEFAULT_CONTEXT_WINDOW) return CONTEXT_1M
  return DEFAULT_CONTEXT_WINDOW
}

/**
 * Tokens Claude Code keeps free below the window before it auto-compacts:
 * 20,000 reserved for the reply (min(max output, 20k)) plus a 13,000 buffer.
 * Read from Claude Code 2.1.321: threshold = window − min(maxOutput, 20000) − 13000.
 * A fixed amount, not a share of the window: 83.5% of 200k, 96.7% of 1M.
 */
export const AUTOCOMPACT_RESERVE_TOKENS = 33_000

/** Percentage of the window at which Claude Code auto-compacts. */
export function autocompactThresholdPct(contextLimit: number): number {
  if (contextLimit <= AUTOCOMPACT_RESERVE_TOKENS) return 0
  return ((contextLimit - AUTOCOMPACT_RESERVE_TOKENS) / contextLimit) * 100
}
