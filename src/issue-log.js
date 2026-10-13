// -----------------------------------------------------------------------------
// Deduplicated logging of a recurring failure.
//
// A failure that repeats on every refresh (Open-Meteo unreachable, a limit
// reached, the houses of Gladys unreadable) is logged once when it starts, and
// once when it ends: not once per attempt, which would fill the logs of Gladys
// for as long as it lasts. The repeats go to debug.
// -----------------------------------------------------------------------------

/**
 * @description Create a log of ongoing issues.
 * @param {object} logger - Logger with info/warn/debug.
 * @returns {object} `{ fail, recover, retain, active }`.
 * @example
 * const issues = createIssueLog(logger);
 * issues.fail('api', 'network', 'Open-Meteo unreachable');
 * issues.recover('api', 'Open-Meteo answers again');
 */
function createIssueLog(logger) {
  // key -> signature of the failure under way
  const ongoing = new Map();

  /**
   * @description Report a failure: a warning the first time, or when its
   * signature (its kind) changes; debug while it repeats.
   * @param {string} key - What fails (a location, the houses).
   * @param {string} signature - The kind of failure.
   * @param {string} message - The line to log.
   * @example
   * issues.fail('48.857,2.352', 'network', 'Open-Meteo request failed: timeout');
   */
  function fail(key, signature, message) {
    if (ongoing.get(key) === signature) {
      logger.debug(message);
      return;
    }
    ongoing.set(key, signature);
    logger.warn(message);
  }

  /**
   * @description Report a success: one info line if a failure was under way,
   * nothing otherwise.
   * @param {string} key - What works again.
   * @param {string} message - The line to log.
   * @example
   * issues.recover('48.857,2.352', 'Open-Meteo answers again');
   */
  function recover(key, message) {
    if (ongoing.delete(key)) {
      logger.info(message);
    }
  }

  /**
   * @description Forget the issues whose key is not kept (a house removed).
   * @param {Function} keep - `(key) => boolean`.
   * @example
   * issues.retain((key) => keys.has(key));
   */
  function retain(keep) {
    for (const key of ongoing.keys()) {
      if (!keep(key)) {
        ongoing.delete(key);
      }
    }
  }

  return {
    fail,
    recover,
    retain,
    get active() {
      return ongoing.size;
    },
  };
}

export { createIssueLog };
