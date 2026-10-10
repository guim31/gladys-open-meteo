// -----------------------------------------------------------------------------
// The refresh timer: one cycle refreshes every located house, then waits for
// the configured interval (15 minutes by default).
//
// A timer inside the container, not the Gladys device polling: a weather
// integration has no devices. It is a chain of timeouts rather than an
// interval so that a settings change, or a failed cycle retried sooner,
// re-plans the next cycle cleanly.
//
// Houses closer than ~110 m share one call (forecast-store.js). A cycle stops
// at a request limit (429), which would repeat for every house; any other
// failure only skips its house. Cycles never overlap: a cycle asked for
// while one runs is queued behind it.
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './api.js';
import { locationKey } from './forecast-store.js';

// After a cycle where every call failed for a passing reason (network, 5xx),
// try again sooner than the full interval.
const RETRY_AFTER_FAILURE_MS = 5 * 60 * 1000;

/**
 * @description Create the refresh scheduler.
 * @param {object} options - Options.
 * @param {object} options.houses - The house registry (houses.js).
 * @param {object} options.store - The forecast store (forecast-store.js).
 * @param {Function} options.getIntervalMinutes - `() => number`, the
 * interval set by the user.
 * @param {Function} [options.onRefreshed] - `(house, entry) => Promise|void`,
 * called for every house after its forecast was refreshed.
 * @param {Function} [options.onCycle] - `(summary) => Promise|void`, called at
 * the end of each cycle with `{ houses, locations, refreshed, error, delayMs }`.
 * @param {object} [options.logger] - Logger with info/warn/debug.
 * @param {Function} [options.now] - `() => ms`, for the tests.
 * @param {Function} [options.setTimer] - setTimeout, for the tests.
 * @param {Function} [options.clearTimer] - clearTimeout, for the tests.
 * @returns {object} The scheduler ({ start, stop, requestCycle, reschedule,
 * settled }).
 * @example
 * const scheduler = createScheduler({ houses, store, getIntervalMinutes: () => 15 });
 */
function createScheduler({
  houses,
  store,
  getIntervalMinutes,
  onRefreshed = () => {},
  onCycle = () => {},
  logger = console,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let timer = null;
  let running = null;
  let queued = false;
  let started = false;
  let lastCycleAt = null;

  /**
   * @description Arm the next cycle.
   * @param {number} delayMs - The delay.
   * @example
   * schedule(15 * 60000);
   */
  function schedule(delayMs) {
    if (!started) {
      return;
    }
    if (timer !== null) {
      clearTimer(timer);
    }
    timer = setTimer(() => {
      timer = null;
      return requestCycle();
    }, delayMs);
    // Never hold the process alive just for the timer.
    timer?.unref?.();
  }

  /**
   * @description Run one cycle: refresh every located house once.
   * @returns {Promise<object>} The summary.
   * @example
   * await cycle();
   */
  async function cycle() {
    lastCycleAt = now();
    const located = await houses.refresh();
    let refreshed = 0;
    let failed = 0;
    let error = store.blockedError();

    // One call per distinct location, every house of it notified.
    const groups = new Map();
    for (const house of located) {
      const key = locationKey(house.latitude, house.longitude);
      groups.set(key, [...(groups.get(key) ?? []), house]);
    }

    if (error === null) {
      for (const group of groups.values()) {
        try {
          const entry = await store.refresh(group[0].latitude, group[0].longitude);
          refreshed += 1;
          for (const house of group) {
            try {
              await onRefreshed(house, entry);
            } catch (err) {
              logger.warn(`Post-refresh handling failed for "${house.name}": ${err.message}`);
            }
          }
        } catch (err) {
          failed += 1;
          error = err;
          logger.warn(`Refresh failed for "${group[0].name}": ${err.message}`);
          if (err.kind === ERROR_KINDS.LIMIT) {
            break;
          }
        }
      }
    }
    store.prune(new Set(groups.keys()));

    let delayMs = getIntervalMinutes() * 60 * 1000;
    if (error !== null && refreshed === 0 && failed > 0 && error.kind !== ERROR_KINDS.LIMIT) {
      delayMs = Math.min(delayMs, RETRY_AFTER_FAILURE_MS);
    }

    const summary = {
      houses: located.length,
      locations: groups.size,
      refreshed,
      error,
      delayMs,
    };
    try {
      await onCycle(summary);
    } catch (err) {
      logger.warn(`End-of-cycle handling failed: ${err.message}`);
    }
    schedule(delayMs);
    return summary;
  }

  /**
   * @description Run a cycle now, or right after the one under way.
   * @returns {Promise<object>} The summary of the cycle that ran.
   * @example
   * await scheduler.requestCycle();
   */
  function requestCycle() {
    if (running !== null) {
      queued = true;
      return running;
    }
    running = cycle()
      .catch((err) => {
        logger.warn(`Refresh cycle failed: ${err.message}`);
        schedule(RETRY_AFTER_FAILURE_MS);
        return { houses: 0, locations: 0, refreshed: 0, error: err, delayMs: null };
      })
      .finally(() => {
        running = null;
        if (queued) {
          queued = false;
          requestCycle();
        }
      });
    return running;
  }

  /**
   * @description Re-plan the next cycle after a settings change, counting from
   * the last cycle: a shorter interval takes effect without a call now, a
   * longer one pushes the next cycle back.
   * @example
   * scheduler.reschedule();
   */
  function reschedule() {
    if (!started || running !== null || lastCycleAt === null) {
      return;
    }
    const delayMs = getIntervalMinutes() * 60 * 1000;
    schedule(Math.max(0, lastCycleAt + delayMs - now()));
  }

  /**
   * @description Start the refreshes: a first cycle right away.
   * @returns {Promise<object>} The summary of the first cycle.
   * @example
   * await scheduler.start();
   */
  function start() {
    started = true;
    return requestCycle();
  }

  /**
   * @description Wait for the cycle under way, if any (and the one queued
   * behind it).
   * @returns {Promise<void>} Resolves once no cycle runs.
   * @example
   * await scheduler.settled();
   */
  async function settled() {
    while (running !== null) {
      await running;
    }
  }

  /**
   * @description Stop the refreshes.
   * @example
   * scheduler.stop();
   */
  function stop() {
    started = false;
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  }

  return {
    start,
    stop,
    requestCycle,
    reschedule,
    settled,
    get started() {
      return started;
    },
  };
}

export { RETRY_AFTER_FAILURE_MS, createScheduler };
