import { logger } from '../utils/logger.js';
import { recordCircuitBreakerOpen } from '../utils/metrics.js';

export type CircuitStatus = 'closed' | 'open' | 'half-open';

export interface CircuitState {
  status: CircuitStatus;
  failures: number;
  openUntil: number;
  currentCooldownMs: number;
}

export interface CircuitBreakerOptions {
  threshold: number;
  cooldownMs: number;
  maxCooldownMs: number;
}

const DEFAULT_OPTIONS: CircuitBreakerOptions = {
  threshold: 3,
  cooldownMs: 5 * 60_000,
  maxCooldownMs: 30 * 60_000,
};

export interface CircuitBreaker {
  isOpen(): boolean;
  canAttempt(): boolean;
  recordSuccess(): void;
  recordFailure(): void;
  getState(): Readonly<CircuitState>;
  reset(): void;
}

export function createCircuitBreaker(opts: Partial<CircuitBreakerOptions> = {}): CircuitBreaker {
  const options = { ...DEFAULT_OPTIONS, ...opts };

  const state: CircuitState = {
    status: 'closed',
    failures: 0,
    openUntil: 0,
    currentCooldownMs: options.cooldownMs,
  };

  function isOpen(): boolean {
    if (state.status === 'closed') return false;
    if (Date.now() >= state.openUntil) {
      state.status = 'half-open';
      return false;
    }
    return true;
  }

  function canAttempt(): boolean {
    return !isOpen();
  }

  function recordSuccess(): void {
    if (state.status !== 'closed') {
      logger.info('ML circuit breaker reset — HTTP scraping restored');
    }
    state.status = 'closed';
    state.failures = 0;
    state.currentCooldownMs = options.cooldownMs;
  }

  function recordFailure(): void {
    state.failures++;

    if (state.status === 'half-open') {
      state.currentCooldownMs = Math.min(state.currentCooldownMs * 2, options.maxCooldownMs);
      state.status = 'open';
      state.openUntil = Date.now() + state.currentCooldownMs;
      recordCircuitBreakerOpen();
      logger.warn(
        { cooldownMs: state.currentCooldownMs },
        'ML circuit breaker re-opened (half-open probe failed) — skipping HTTP',
      );
      return;
    }

    if (state.failures >= options.threshold) {
      state.status = 'open';
      state.openUntil = Date.now() + state.currentCooldownMs;
      recordCircuitBreakerOpen();
      logger.warn(
        { failures: state.failures, cooldownMs: state.currentCooldownMs },
        'ML circuit breaker opened — HTTP blocked, skipping for cooldown period',
      );
    }
  }

  function getState(): Readonly<CircuitState> {
    isOpen();
    return { ...state };
  }

  function reset(): void {
    state.status = 'closed';
    state.failures = 0;
    state.openUntil = 0;
    state.currentCooldownMs = options.cooldownMs;
  }

  return { isOpen, canAttempt, recordSuccess, recordFailure, getState, reset };
}

export const mlCircuitBreaker = createCircuitBreaker();
