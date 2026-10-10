// -----------------------------------------------------------------------------
// The houses of the Gladys instance: the locations the integration refreshes.
//
// The weather path alone would not need them — the core sends the coordinates
// of the house in every weather request — but the "precipitation within the
// hour" trigger must watch the forecast on its own, and the core only asks for
// the weather when a dashboard, the chat or an alert scene needs it. Hence
// `location: true` in the manifest and getHouses() here.
//
// There is no update event for the houses: they are re-read on every
// connection and at the start of every refresh cycle (a local call).
// -----------------------------------------------------------------------------

/**
 * @description Normalize a house name or selector for a lenient comparison.
 * @param {string} value - The value to normalize.
 * @returns {string} The trimmed, lower-cased, accent-free value.
 * @example
 * normalizeName(' Résidence '); // -> 'residence'
 */
function normalizeName(value) {
  return String(value)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase();
}

/**
 * @description Whether a "House" field is empty (any house).
 * @param {any} value - The "House" field of a trigger, an action or a widget.
 * @returns {boolean} True when empty.
 * @example
 * isAnyHouse(''); // -> true
 */
function isAnyHouse(value) {
  return value === null || value === undefined || String(value).trim() === '';
}

/**
 * @description Whether a house matches a "House" field: its name or its
 * selector, ignoring case and accents. An empty field matches every house.
 * @param {object} house - The house.
 * @param {any} wanted - The field value.
 * @returns {boolean} True when it matches.
 * @example
 * houseMatches({ name: 'Résidence', selector: 'residence' }, 'residence'); // -> true
 */
function houseMatches(house, wanted) {
  if (isAnyHouse(wanted)) {
    return true;
  }
  const target = normalizeName(wanted);
  return normalizeName(house.name) === target || normalizeName(house.selector) === target;
}

/**
 * @description Create the house registry.
 * @param {object} options - Options.
 * @param {Function} options.fetchHouses - `() => Promise<Array<object>>`, the
 * SDK getHouses().
 * @param {object} [options.logger] - Logger with info/warn/debug.
 * @returns {object} The registry ({ refresh, list, resolve }).
 * @example
 * const houses = createHouseRegistry({ fetchHouses: () => gladys.getHouses() });
 */
function createHouseRegistry({ fetchHouses, logger = console }) {
  // Located houses only: an unlocated house has no weather.
  let located = [];

  /**
   * @description Re-read the houses from Gladys. A failure keeps the previous
   * list: a transient error must not stop the refreshes.
   * @returns {Promise<Array<object>>} The located houses.
   * @example
   * await houses.refresh();
   */
  async function refresh() {
    try {
      const houses = await fetchHouses();
      located = (Array.isArray(houses) ? houses : []).filter(
        (house) => Number.isFinite(house?.latitude) && Number.isFinite(house?.longitude),
      );
    } catch (err) {
      logger.warn(`Unable to read the houses of Gladys: ${err.message}`);
    }
    return located;
  }

  /**
   * @description The located houses, as last read.
   * @returns {Array<object>} `[{ id, name, selector, latitude, longitude }]`.
   * @example
   * houses.list();
   */
  function list() {
    return located;
  }

  /**
   * @description Find the house a scene action or a widget targets. An empty
   * value means the first located house — the common single-house case.
   * @param {any} wanted - The "House" field.
   * @returns {object} The house.
   * @throws {Error} When no house is located or none matches.
   * @example
   * houses.resolve('Lake house');
   */
  function resolve(wanted) {
    if (located.length === 0) {
      throw new Error('No house of Gladys has a location: set it in the house settings');
    }
    const house = located.find((candidate) => houseMatches(candidate, wanted));
    if (house === undefined) {
      throw new Error(`No located house named "${String(wanted).trim()}"`);
    }
    return house;
  }

  return { refresh, list, resolve };
}

export { createHouseRegistry, houseMatches, isAnyHouse, normalizeName };
