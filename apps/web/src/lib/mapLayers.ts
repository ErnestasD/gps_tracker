/**
 * Which optional overlays the map is drawing.
 *
 * Kept as data (and in one place) because the toggles, the layer visibility calls and the
 * persistence all have to agree on the same set — a fourth switch added to the menu but not to the
 * apply step is an overlay that silently never appears.
 */
export interface MapLayers {
  /** Account geofences, filled and outlined in their own colour. */
  geofences: boolean
  /** The selected vehicle's live trail AND its 24-hour track. */
  trails: boolean
  /** Device names beside the markers. */
  labels: boolean
  /** Fleet density overlay — one weight per device. */
  heat: boolean
}

export const DEFAULT_LAYERS: MapLayers = {
  geofences: true,
  trails: true,
  labels: false,
  heat: false,
}

const KEY = 'orbetra.map.layers'

/**
 * Layer choices survive a reload, because they are a working setup rather than a preference: an
 * operator who turned zones off to read a dense city does not want them back on every refresh.
 * Unknown/removed keys are ignored — a stored blob from an older build must never widen the type.
 */
export function loadLayers(storage: Pick<Storage, 'getItem'> | undefined = safeStorage()): MapLayers {
  try {
    const raw = storage?.getItem(KEY)
    if (raw === null || raw === undefined) return DEFAULT_LAYERS
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object') return DEFAULT_LAYERS
    const out = { ...DEFAULT_LAYERS }
    for (const k of Object.keys(DEFAULT_LAYERS) as (keyof MapLayers)[]) {
      const v = (parsed as Record<string, unknown>)[k]
      if (typeof v === 'boolean') out[k] = v
    }
    return out
  } catch {
    return DEFAULT_LAYERS
  }
}

export function saveLayers(layers: MapLayers, storage: Pick<Storage, 'setItem'> | undefined = safeStorage()): void {
  try {
    storage?.setItem(KEY, JSON.stringify(layers))
  } catch {
    // a full or blocked quota must never break the map
  }
}

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined // Safari private mode throws on access
  }
}
