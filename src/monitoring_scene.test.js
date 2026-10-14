const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  collectVisionSceneStats,
  formatVisionSceneRow,
  normalizeOutgoingHit,
} = require("./monitoring_scene.js");

describe("collectVisionSceneStats", () => {
  it("counts players, parties, and aggro", () => {
    const stats = collectVisionSceneStats({
      self: { name: "Ahnaki", party: "Ahnaki", target: "6001" },
      entities: {
        MoulinRogue: {
          name: "MoulinRogue",
          party: "Ahnaki",
          ctype: "rogue",
          target: "6001",
        },
        earthWar: { name: "earthWar", party: "earthPri", ctype: "warrior" },
        "6001": { mtype: "mrpumpkin", target: "earthWar", hp: 1 },
        "6002": { mtype: "fvampire", hp: 1 },
      },
    });
    assert.equal(stats.players, 3);
    assert.equal(stats.parties, 2);
    assert.equal(stats.mobs, 2);
    assert.equal(stats.mobsAggro, 1);
    assert.equal(stats.playersFighting, 2);
  });

  it("skips npc/dead and does not double-count self", () => {
    const stats = collectVisionSceneStats({
      self: { name: "Ahnaki", id: "Ahnaki" },
      entities: {
        Ahnaki: { name: "Ahnaki", ctype: "warrior" },
        town: { npc: true, name: "Ace" },
        corpse: { mtype: "osnake", dead: true, target: "x" },
      },
    });
    assert.equal(stats.players, 1);
    assert.equal(stats.mobs, 0);
    assert.equal(stats.mobsAggro, 0);
  });
});

describe("formatVisionSceneRow", () => {
  it("renders compact chips", () => {
    assert.deepEqual(
      formatVisionSceneRow({
        players: 12,
        parties: 3,
        mobs: 10,
        mobsAggro: 8,
        playersFighting: 4,
      }),
      {
        left: "12 pl · 3 pty",
        middle: "",
        right: "8 mob↗ · 4 pc↗",
      },
    );
  });
});

describe("normalizeOutgoingHit", () => {
  it("accepts socket hid/id hits from self", () => {
    assert.deepEqual(
      normalizeOutgoingHit(
        { hid: "RedMill", id: "6001", damage: 1200 },
        "RedMill",
        "RedMill",
      ),
      { hid: "RedMill", tid: "6001", damage: 1200 },
    );
  });

  it("accepts target_hit payloads without hid", () => {
    assert.deepEqual(
      normalizeOutgoingHit({ target: "6001", damage: 900 }, "RedMill", "RedMill"),
      { hid: null, tid: "6001", damage: 900 },
    );
  });

  it("rejects other players' hits", () => {
    assert.equal(
      normalizeOutgoingHit(
        { hid: "earthWar", id: "6001", damage: 500 },
        "RedMill",
        "RedMill",
      ),
      null,
    );
  });
});
