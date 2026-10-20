/**
 * Vision-radius scene counters for the BWI strip under the minimap.
 * Pure — no game globals.
 */

/**
 * @param {{
 *   entities?: Record<string, {
 *     npc?: boolean,
 *     dead?: boolean,
 *     mtype?: string,
 *     target?: string|null,
 *     party?: string|null,
 *     name?: string,
 *     id?: string,
 *   }>,
 *   self?: {
 *     npc?: boolean,
 *     party?: string|null,
 *     target?: string|null,
 *     name?: string,
 *     id?: string,
 *   }|null,
 * }} args
 */
function collectVisionSceneStats(args) {
  const entities = args.entities || {};
  const self = args.self || null;
  let players = 0;
  let playersFighting = 0;
  let mobs = 0;
  let mobsAggro = 0;
  const parties = new Set();

  const selfKeys = new Set();
  if (self && self.name) selfKeys.add(self.name);
  if (self && self.id) selfKeys.add(self.id);

  if (self && !self.npc) {
    players += 1;
    if (self.party) parties.add(String(self.party));
    if (self.target) playersFighting += 1;
  }

  for (const id in entities) {
    const ent = entities[id];
    if (!ent || ent.npc || ent.dead) continue;
    if (selfKeys.has(id) || (ent.name && selfKeys.has(ent.name))) continue;
    if (ent.mtype) {
      mobs += 1;
      if (ent.target) mobsAggro += 1;
      continue;
    }
    players += 1;
    if (ent.party) parties.add(String(ent.party));
    if (ent.target) playersFighting += 1;
  }

  return {
    players,
    parties: parties.size,
    mobs,
    mobsAggro,
    playersFighting,
  };
}

/** Compact left/right chips for leftMiddleRightText under the minimap. */
function formatVisionSceneRow(stats) {
  if (!stats) {
    return { left: "", middle: "", right: "" };
  }
  return {
    left: `${stats.players} pl · ${stats.parties} pty`,
    middle: "",
    right: `${stats.mobsAggro} mob↗ · ${stats.playersFighting} pc↗`,
  };
}

/**
 * Normalize AL hit payloads (socket hid/id vs target_hit target/damage).
 * @returns {{ hid: string|null, tid: string|null, damage: number }|null}
 */
function normalizeOutgoingHit(data, selfName, selfId) {
  if (!data || data.damage == null || !(Number(data.damage) > 0)) return null;
  const hid = data.hid != null ? data.hid : data.actor != null ? data.actor : null;
  const tid = data.target != null ? data.target : data.id != null ? data.id : null;
  // target_hit is already scoped to our outgoing hits (no hid).
  if (hid != null && hid !== selfName && hid !== selfId) return null;
  if (tid == null) return null;
  return { hid: hid != null ? String(hid) : null, tid: String(tid), damage: Number(data.damage) };
}

module.exports = {
  collectVisionSceneStats,
  formatVisionSceneRow,
  normalizeOutgoingHit,
};
