import { z } from 'zod'

/**
 * How the telemetry endpoint describes ONE element it is sending a value for.
 *
 * The browser has no AVL table and cannot get one: the same id is a fuel level on fmb120 and an
 * axle weight on fmc650, and only the server knows which table a device speaks. So the description
 * travels with the value. It lives here rather than in either app because CLAUDE.md makes this
 * package the single source of the types api/web/worker share — the previous arrangement had the
 * shape written out twice, and the two copies had already drifted (`adoptedFrom` reached 966 shipped
 * rows while appearing in neither).
 */
export const attrLabelSchema = z.object({
  name: z.string(),
  /** the wiki's Units cell VERBATIM: provenance, and what a reader sees when nothing overrides it */
  units: z.string().optional(),
  /**
   * The unit of `raw × multiplier`, which is NOT always the Units cell.
   *
   * Teltonika's Multiplier column means two opposite things: on id 10879 the cell describes the
   * RESULT (`raw × 50` millivolts is how a 400 V traction pack reports), on id 67 it describes the
   * RAW wire value (`raw × 0.001` is already volts). A reader that rescales on the SI prefix in
   * `units` divides the second kind twice — a healthy 12.6 V battery rendered `0.0 V`, the exact
   * reading of dead hardware.
   *
   * THREE STATES, and flattening any two of them is a bug:
   *   absent  — `units` IS the post-multiplier unit. Read `unitAfterMultiplier ?? units`.
   *   string  — it is not, and this is.
   *   `null`  — REFUSED. Claim no unit: show the number bare, and never treat it as "unitless" in
   *             the sense that would invite a percentage bar or any other invented maximum.
   */
  unitAfterMultiplier: z.string().nullable().optional(),
  /**
   * Already a number. The wiki's cell is written in two decimal conventions and 29% of cells are
   * not numbers at all, so the server parses it in ONE place and omits the field rather than
   * sending something the browser would have to guess at.
   */
  multiplier: z.number().optional(),
  /** the wiki's "Parameter Group" cell verbatim, e.g. "CAN Chip", "Permanent I/O elements" */
  group: z.string().optional(),
  /** the wiki's "Max" cell verbatim — identifies a documented bitmask */
  max: z.string().optional(),
})

export type AttrLabel = z.infer<typeof attrLabelSchema>
