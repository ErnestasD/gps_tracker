/**
 * Teltonika element names, in the operator's language.
 *
 * The names arrive from the AVL dictionaries and are English, because the wiki is: "Fuel Level",
 * "Engine Coolant Temperature", "Tire 3 pressure". There are 2,718 distinct ones across the 37
 * shipped tables, and translating a list that size word-by-word would produce nonsense in an
 * inflected language — Lithuanian needs "Akumuliatoriaus įtampa", not "Baterija Įtampa". So the
 * unit of translation is the whole NAME, with the numbers pulled out.
 *
 * Numbers are what make the list tractable. "Battery Voltage 1".."Battery Voltage 10" is one
 * phrase, so a name is normalised to a pattern — every run of digits becomes `#` — looked up, and
 * the digits are put back in order. 2,718 names collapse to 1,553 patterns that way.
 *
 * FALLBACK IS THE CONTRACT. An unknown pattern returns the English name unchanged, never a
 * half-translated string: "Tire 3 slėgis" would be worse than either language on its own. That also
 * means this table can grow one entry at a time without a flag day, and a name Teltonika adds
 * tomorrow degrades to English rather than to a gap.
 */

import { AVL_NAMES_DE } from './avlNames.de'
import { AVL_NAMES_LT } from './avlNames.lt'
import { AVL_NAMES_PL } from './avlNames.pl'

/**
 * Every run of digits becomes a placeholder: "BLE 1 Custom #2" → "BLE {} Custom #{}".
 *
 * `{}` and not `#`, because `#` is a LITERAL character in Teltonika's own names — "BLE Fuel
 * Frequency #1", "BLE Button 1 state #3". Using it as the placeholder made a pattern that could
 * never match its own element, which the "every key names a real element" test caught before any
 * of this shipped.
 */
const DIGITS = /\d+/g
const PLACEHOLDER = /\{\}/g

export const avlPattern = (name: string): string => name.replace(DIGITS, '{}')

const TABLES: Record<string, Readonly<Record<string, string>>> = {
  lt: AVL_NAMES_LT,
  pl: AVL_NAMES_PL,
  de: AVL_NAMES_DE,
}

/**
 * The element name as this reader should see it, or the English original.
 *
 * `lang` is matched on the two-letter prefix, like the rest of the app: `lt-LT` is Lithuanian. A
 * translation carries the same `#` placeholders as its pattern and in the same order, which the
 * package's own test asserts — a mismatched count would silently drop a tyre's number.
 */
export function translateAvlName(name: string, lang: string): string {
  const table = TABLES[lang.slice(0, 2).toLowerCase()]
  if (table === undefined) return name
  const hit = table[avlPattern(name)]
  if (hit === undefined) return name
  const numbers = name.match(DIGITS)
  if (numbers === null) return hit
  let i = 0
  return hit.replace(PLACEHOLDER, () => numbers[i++] ?? '{}')
}
