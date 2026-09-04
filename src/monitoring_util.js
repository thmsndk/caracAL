const prettyMilliseconds = require("pretty-ms");
const { STAT_BEAT_INTERVAL } = require("./CONSTANTS.js");
const { max, min, abs, round, floor } = Math;

function humanize_int(num, digits) {
  num = round(num);
  const lookup = [
    { value: 1e3, symbol: "" },
    { value: 1e6, symbol: "k" },
    { value: 1e9, symbol: "Mil" },
    { value: 1e12, symbol: "Bil" },
    { value: 1e15, symbol: "Tril" },
  ];

  const rx = /\.0+$|(\.[0-9]*[1-9])0+$/;
  const item = lookup.find(function (item) {
    return abs(num) < item.value;
  });

  return item
    ? ((num * 1e3) / item.value).toFixed(digits).replace(rx, "$1") + item.symbol
    : num.toExponential(digits);
}

function register_stat_beat(game_context) {
  function scqMapGData(propKey, props) {
    if (props === undefined) return;

    switch (propKey) {
      case "s": {
        // s is conditions or buffs
        // G.conditions has stat information on most conditions
        // If a condition isn't present, it will likely not be in "s"
        // "ms" is milliseconds left
        // "cursed": {"ms":400},
        // "mluck": {"ms":120000,"f":"MerchantName"},
        // "citizen0aura": {"ms":12000,"name":"Citizen's Aura","skin":"citizensaura","luck":100},
        // ^ an example of a dynamically generated status that's not on G.conditions
        // "invis": false,
        if (Object.keys(props).length === 0) return; // make an empty object undefined

        const gConditions = game_context.G.conditions;
        const result = {};

        for (const conditionKey in props) {
          const prop = props[conditionKey];

          if (typeof prop === "boolean") {
            result[conditionKey] = prop;
          } else {
            const gCondition = gConditions[conditionKey];
            const newProp = { ...prop };
            newProp.name = gCondition?.name ?? prop.name ?? conditionKey;

            switch (conditionKey) {
              case "young":
                newProp.ims = 500;
                break;

              default:
                newProp.ims =
                  gCondition?.duration ?? 12000; /* citizen aura default ms */
                break;
            }

            result[conditionKey] = newProp;
          }
        }

        return result;
      }

      case "c": {
        // c is channeled actions, like fishing
        // "town": {"ms":3000}, // Set when "town" portal is in progress
        // "revival": {ms:8000,f:"PriestName"}, // Set when revival is in progress
        if (Object.keys(props).length === 0) return; // make an empty object undefined

        const gConditions = game_context.G.conditions;
        const result = {};

        for (const key in props) {
          const prop = props[key];

          const gCondition = gConditions[key];
          const newProp = { ...prop };
          newProp.name = gCondition?.name ?? prop.name ?? key;
          newProp.ims = gCondition?.duration ?? 12000;
          result[key] = newProp;
        }

        return result;
      }
      case "q": {
        // q is progressed actions, upgrade, compound, exchange
        // "upgrade": {"ms":2000,"len":2000,"num":5}, // Item at inventory position #5 is being upgraded
        // "compound": {"ms":8000,"len":10000,"num":0}, // Item at inventory position #0 is being compounded
        // "exchange": {"ms":3000,name:"gem0","num":12}, // A "gem0" exchange is in progress
        if (Object.keys(props).length === 0) return; // make an empty object undefined

        const gItems = game_context.G.items;
        const result = {};

        for (const key in props) {
          const prop = props[key];

          const gItem = gItems[key];
          const newProp = { ...prop };
          newProp.name = gItem?.name ?? prop.name ?? key;
          newProp.ims = prop.len ?? 12000;
          result[key] = newProp;
        }

        return result;
      }
    }

    return props;
  }

  let loot = [];
  game_context.character.on("loot", function (data) {
    if (!data.items) return;
    const itemsByKey = {};
    for (const itemInfo of data.items) {
      if (itemInfo.looter === game_context.character.name) {
        const key = `${itemInfo.name}${itemInfo.p ?? ""}`;

        let data = itemsByKey[key];
        if (!data) {
          itemInfo.gName =
            game_context.G.items[itemInfo.name]?.name ?? itemInfo.name;

          itemInfo.gTitle = getTitleName(itemInfo, game_context.G);

          // const levelString = getLevelString(gItem, itemInfo.level);

          if (!itemInfo.q) itemInfo.q = 1;

          data = { time: new Date(), ...itemInfo };
          itemsByKey[key] = data;
        } else {
          // group the same items in the same chest to a single entry
          // for example when easter eggs drops
          data.q += itemInfo.q;
        }
      }
    }

    for (const key in itemsByKey) {
      loot.splice(0, 0, itemsByKey[key]);
    }
  });

  let bank = {};
  let bank_free_count = 0;
  let bank_used_count = 0;
  let bank_total_count = 0;
  function updateBankCount() {
    let free = 0;
    let used = 0;
    let total = 0;
    for (const packKey in game_context.bank_packs) {
      const cPack = bank[packKey];

      if (!cPack) continue;

      const cPackSpaces = cPack.length > 0 ? cPack.length : 42; // a freshly bought bank tab seems to be initialized as an empty array
      for (let index = 0; index < cPackSpaces; index++) {
        const item = cPack[index];

        total++;

        if (!item) {
          free++;
          continue;
        }

        used++;
      }
    }
    bank_free_count = free;
    bank_used_count = used;
    bank_total_count = total;
  }

  game_context.caracAL.stat_beat = setInterval(() => {
    const result = { type: "stat_beat" };

    const time = new Date();
    loot = loot.filter((item) => {
      return (
        time.getTime() - item.time.getTime() <
        12 * 60 * 60 * 1000 /* 12 hours */
      );
    });

    result.loot = loot;

    const character = game_context.character;

    const entityProps = [
      "id",
      "name",
      "type",
      "mtype",
      "ctype",
      "rip",
      "hp",
      "max_hp",
      "mp",
      "max_mp",
      "level",
      "xp",
      "max_xp",
      "target",
      "s", // Conditions or Buffs
      "c", // Channeling actions
      "q", // Progressed actions
      "party",
      "x", // often 0 ? seems to be view specific?
      "real_x", // world coordinates
      "y", // often 0 ? seems to be view specific?
      "real_y", // world coordinates
      "map",
    ];

    [
      ...entityProps,
      "ping",
      "gold",
      "isize",
      "esize",
      "goldm",
      "luckm",
      "xpm",
    ].forEach((x) => {
      if (x === "type") return; // don't override result.type, it's the message type
      // create_monitor_ui does not have the game_context, so we look up values here
      const propValue = scqMapGData(x, character[x]);
      result[x] = propValue;
    });

    if (character.bank) {
      bank = character.bank;
      updateBankCount();
    }

    result.bank_free_count = bank_free_count;
    result.bank_used_count = bank_used_count;
    result.bank_total_count = bank_total_count;

    const { pings, server_region, server_identifier, X } = game_context;

    // Official keys are region+identifier (USI). Custom/local servers often use
    // prefixed keys (SR_USI) while still exposing region/name as US/I.
    const servers = (X && X.servers) || [];
    const server =
      servers.find((x) => x.key === server_region + server_identifier) ||
      servers.find(
        (x) => x.region === server_region && x.name === server_identifier,
      );

    result.pings = pings;
    result.server_players = server ? server.players : undefined;
    // server_name is the full server name Europas I

    // party_list
    result.partyEntities = [];
    for (const name of game_context.party_list) {
      // game_context.party only contains location data
      const entity = game_context.entities[name];
      const entityResult = { name: name };
      result.partyEntities.push(entityResult);

      if (!entity) continue;

      ["name", "hp", "max_hp", "mp", "max_mp"].forEach((x) => {
        // create_monitor_ui does not have the game_context, so we look up values here
        // const propValue = scqMapGData(x, targetEntity[x]);
        const propValue = entity[x];
        entityResult[x] = propValue ?? entityResult[x];
      });
    }

    const targetEntity = game_context.entities[character.target];
    if (targetEntity) {
      result.target = {};
      entityProps.forEach((x) => {
        // create_monitor_ui does not have the game_context, so we look up values here
        const propValue = scqMapGData(x, targetEntity[x]);
        result.target[x] = propValue;
      });

      result.target.distance = game_context.simple_distance(
        character,
        targetEntity,
      );
    } else {
      // target not in entities
      delete result.target;
    }

    const chestsWithItems = Object.values(game_context.chests).filter(
      (chest) => chest.items > 0,
    );
    result.chests = chestsWithItems.length;

    result.current_status = game_context.current_status;
    if (game_context.caracAL.map_enabled()) {
      result.mmap = generate_minimap(game_context);
    }
    process.send(result);
  }, STAT_BEAT_INTERVAL);
}

/**
 *
 * @param {*} bwi
 * @param {*} char_name
 * @param { {instance: any, realm:string} } child_block child_block is a child process with a stat beat
 * @param {*} enable_map
 * @returns
 */
function create_monitor_ui(bwi, char_name, child_block, enable_map) {
  // Future BWI enhancements: loot pie chart and loot/h, DPS/HPS, death stats,
  // timer bar colors by debuff type, revive priest name in timer rightText,
  // target's-target for party assists, ping gradient chart, goldm/luckm/xpm display,
  // movement speed and aggro counts, bot-forwarded custom timers, server events.

  let xp_histo = [];
  let xp_ph = 0;
  let gold_histo = [];
  let last_beat = null;
  /** Wall clock when last_beat was received — for stale age + timer interpolation. */
  let last_beat_at = 0;

  child_block.instance.on("message", (m) => {
    if (m.type == "stat_beat") {
      gold_histo.push(m.gold);
      gold_histo = gold_histo.slice(-100);

      if (last_beat && last_beat.level != m.level) {
        // clear xp history when we level up
        xp_histo = [];
      }

      xp_histo.push(m.xp);
      xp_histo = xp_histo.slice(-100);

      xp_ph = val_ph(xp_histo);

      last_beat = m;
      last_beat_at = Date.now();

      if (bwi.publisher && typeof bwi.publisher.requestPublish === "function") {
        bwi.publisher.requestPublish();
      }
    }
  });

  function quick_bar_val(num, denom, humanize = false) {
    let modif = (x) => x;
    if (humanize) {
      modif = (x) => humanize_int(x, 1);
    }
    return [(100 * num) / denom, `${modif(num)} / ${modif(denom)}`];
  }

  /**
   * returns a value per hour, per stat beat interval
   * @param {*} arr
   * @returns
   */
  function val_ph(arr) {
    if (arr.length < 2) {
      return 0;
    }
    return (
      ((arr[arr.length - 1] - arr[0]) * 3600000) /
      (arr.length - 1) /
      STAT_BEAT_INTERVAL
    );
  }

  // main interface
  const ui = bwi.publisher.createInterface([
    { name: "server", type: "botUI" },
    { name: "party", type: "botUI" },
    { name: "character", type: "botUI" },
    { name: "target", type: "botUI" },
    { name: "loot", type: "botUI" },
  ]);

  let serverBotUI = ui.createSubBotUI(
    [
      { name: "header", type: "leftMiddleRightText" },
      {
        name: "pings",
        type: "chart",
        label: "Chart",
        options: {
          type: "bar",
        },
      },
    ],
    "server",
  );

  serverBotUI.setDataSource(() => {
    if (!last_beat) {
      return {
        header: { left: "", middle: "Loading...", right: "" },
      };
    }

    return {
      header: {
        left: `${last_beat.server_players} online`,
        middle: child_block.realm,
        right: Math.floor(last_beat.ping),
      },
      pings: {
        // pings contains 40 entries from game_context.pings
        data: {
          labels: last_beat.pings.map((p, index) => index),
          datasets: [
            {
              data: last_beat.pings.map((p) => p),
            },
          ],
        },
      },
    };
  });

  let partyBotUI = ui.createSubBotUI(
    [
      // leader ??? size
      { name: "header", type: "leftMiddleRightText" },
      {
        // chart for each char with health and mana
        name: "health_mana",
        type: "chart",
        label: "Chart",
        options: {
          type: "bar",
        },
      },
    ],
    "party",
  );

  partyBotUI.setDataSource(() => {
    if (!last_beat) {
      return {
        header: { left: "", middle: "Loading...", right: "" },
      };
    }

    if (last_beat.partyEntities.length == 0) {
      return {};
    }

    return {
      header: {
        left: `${last_beat.party}`,
        middle: "",
        right: last_beat.partyEntities.length,
      },
      health_mana: {
        data: {
          labels: last_beat.partyEntities.map((x) => x.name),
          datasets: [
            {
              // borderColor: 'rgb(255, 99, 132)',
              backgroundColor: "rgb(255, 99, 132)",
              data: last_beat.partyEntities.map(
                (x) => (100 * (x.hp ?? 0)) / (x.max_hp ?? 1),
              ),
            },
            {
              // borderColor: 'rgb(54, 162, 235)',
              backgroundColor: "rgb(54, 162, 235)",
              data: last_beat.partyEntities.map(
                (x) => (100 * (x.mp ?? 0)) / (x.max_mp ?? 1),
              ),
            },
          ],
        },
      },
    };
  });

  const characterSchema = [
    // [characterName] [status] [level]
    {
      name: "header",
      type: "leftMiddleRightText",
    },
    {
      name: "header2",
      type: "leftMiddleRightText",
    },
    {
      name: "health",
      type: "labelProgressBar",
      label: "Health",
      options: { color: "red" },
    },
    {
      name: "mana",
      type: "labelProgressBar",
      label: "Mana",
      options: { color: "blue" },
    },
    {
      name: "xp",
      type: "labelProgressBar",
      label: "XP",
      options: { color: "green" },
    },
    { name: "xpText", type: "leftMiddleRightText" },
    {
      name: "inv",
      type: "labelProgressBar",
      label: "Inventory",
      options: { color: "brown" },
    },
    {
      name: "bank",
      type: "labelProgressBar",
      label: "bank",
      options: { color: "brown" },
    },
    {
      name: "gold",
      type: "leftMiddleRightText",
    },
    {
      name: "timers",
      type: "timerList",
    },
  ];

  // Structured minimap payload (lines + markers) rendered by BWI canvas widget.
  if (enable_map) {
    characterSchema.splice(2, 0, {
      name: "minimap",
      type: "minimap",
      label: "Map",
      options: {
        width: mmap_w,
        height: mmap_h,
        scale: mmap_scale,
        smoothMs: STAT_BEAT_INTERVAL,
        styles: {
          wall: { stroke: "rgba(226,232,240,0.92)", lineWidth: 1.35 },
          self: { shape: "cross", fill: "#32b1f5" },
          foe: { shape: "cross", fill: "#b14f1d" },
          alert: { shape: "cross", fill: "#c10037" },
          other: { shape: "cross", fill: "#284af4" },
          focus: { shape: "ring", stroke: "#c10037", lineWidth: 1 },
        },
      },
    });
  }

  let characterBotUI = ui.createSubBotUI(characterSchema, "character");

  function scqTimers(s, c, q) {
    const timers = [];
    const sampledAt = last_beat_at;
    const now = Date.now();

    for (const conditionKey in s) {
      const condition = s[conditionKey];
      timers.push(
        timerPresentation({
          name: condition.name,
          ms: condition.ms,
          ims: condition.ims,
          sampledAt,
          now,
        }),
      );
    }

    for (const channeldKey in c) {
      const channel = c[channeldKey];
      timers.push(
        timerPresentation({
          name: channel.name,
          ms: channel.ms,
          ims: channel.ims,
          sampledAt,
          now,
        }),
      );
    }

    for (const actionKey in q) {
      const action = q[actionKey];
      timers.push(
        timerPresentation({
          name: action.name,
          ms: action.ms,
          ims: action.ims,
          sampledAt,
          now,
        }),
      );
    }

    return timers;
  }

  characterBotUI.setDataSource(() => {
    if (!last_beat) {
      return {
        // [characterName] [status] [level]
        header: { left: char_name, middle: "Loading...", right: "" },
        // timers: [],
      };
    }

    const data = {
      header: {
        left: char_name,
        middle: last_beat.rip ? "💀" : last_beat.current_status,
        right: last_beat.level,
        options: {
          // bgColor: CLASS_COLOR[last_beat.ctype],
          leftColor: CLASS_COLOR[last_beat.ctype], // looks better with character name class colored than the entire bg
        },
      },
      header2: {
        left: last_beat.map,
        middle: "",
        right: `${last_beat.real_x.toFixed()}, ${last_beat.real_y.toFixed()}`,
        options: {
          beatAt: last_beat_at,
          staleAfterSec: 2,
        },
      },
      health: quick_bar_val(last_beat.hp, last_beat.max_hp, true),
      mana: quick_bar_val(last_beat.mp, last_beat.max_mp, true),
      xp: quick_bar_val(last_beat.xp, last_beat.max_xp, true),
      xpText: (() => {
        const ttlMs =
          xp_ph > 0
            ? ((last_beat.max_xp - last_beat.xp) * 3600000) / xp_ph
            : 0;
        return {
          left: `XP/h ${humanize_int(xp_ph, 1)}`,
          middle: "",
          right:
            ttlMs > 0
              ? `${prettyMilliseconds(ttlMs, { unitCount: 2 })} TTLU`
              : "N/A TTLU",
          options:
            ttlMs > 0
              ? { levelUpAt: Date.now() + ttlMs, etaSuffix: " TTLU" }
              : { levelUpAt: 0, etaFallback: "N/A TTLU" },
        };
      })(),
      inv: quick_bar_val(last_beat.isize - last_beat.esize, last_beat.isize),
      bank: quick_bar_val(
        last_beat.bank_used_count,
        last_beat.bank_total_count,
      ),
      gold: {
        left: `Gold: ${humanize_int(last_beat.gold, 1)}`,
        middle: "",
        right: `${humanize_int(val_ph(gold_histo), 1)} G/h`,
      },
      timers: scqTimers(last_beat.s, last_beat.c, last_beat.q),
    };
    if (enable_map) {
      data.minimap = last_beat.mmap;
    }
    return data;
  });

  let targetBotUI = ui.createSubBotUI(
    [
      { name: "header", type: "leftMiddleRightText" },
      { name: "header2", type: "leftMiddleRightText" },
      { name: "header3", type: "leftMiddleRightText" },
      {
        name: "health",
        type: "labelProgressBar",
        label: "Health",
        options: { color: "red" },
      },
      {
        name: "mana",
        type: "labelProgressBar",
        label: "Mana",
        options: { color: "blue" },
      },
      {
        name: "timers",
        type: "timerList",
      },
    ],
    "target",
  );

  targetBotUI.setDataSource(() => {
    if (!last_beat) {
      return {
        // [characterName] [status] [level]
        header: { left: "", middle: "Loading...", right: "" },
      };
    }

    const entity = last_beat.target;

    if (!entity) {
      return {
        header: { left: "", middle: "No Target", right: "" },
        header2: { left: "", middle: " ", right: "" },
        health: [100, " "],
        mana: [100, " "],
      };
    }

    return {
      header: {
        left: entity.name,
        middle: entity.rip ? "💀" : entity.target ?? "",
        right: entity.level,
      },
      header2: {
        left: entity.mtype ?? "",
        middle: entity.cooperative ? "🤝 co-op 🤝" : "",
        right:
          entity.distance === 9999999 //Infinity
            ? "♾️"
            : `${entity.distance.toFixed()} 📏`,
      },
      header3: {
        left: entity.map,
        middle: "",
        right: `${entity.real_x.toFixed()}, ${entity.real_y.toFixed()}`,
      },
      health: quick_bar_val(entity.hp, entity.max_hp, true),
      mana: quick_bar_val(entity.mp, entity.max_mp, true),
      timers: scqTimers(entity.s, entity.c, entity.q),
    };
  });

  let lootBotUI = ui.createSubBotUI(
    [
      { name: "lootHeader", type: "leftMiddleRightText" },
      {
        name: "loot",
        type: "table",
        // label: "Looted (12h)",
        headers: ["When", "Item", "#"],
      },
    ],
    "loot",
  );

  lootBotUI.setDataSource(() => {
    if (!last_beat) {
      return {};
    }

    const groupedLoot = last_beat.loot.reduce((acc, x) => {
      const titleName = x.gTitle || "";
      const itemName = x.gName;

      // const levelString = getLevelString(gItem, itemInfo.level);

      let htmlTitle = itemName;
      if (titleName) {
        htmlTitle = `${titleName} ${htmlTitle}`;
      }

      const time = timeAgo(x.time);
      const existingItem = acc.find(
        (item) => item[0] === time && item[1] === htmlTitle,
      );

      if (existingItem) {
        existingItem[2] += x.q;
      } else {
        acc.push([time, htmlTitle, x.q]);
      }

      return acc;
    }, []);

    return {
      // [unopened chest(🪅) count][????][total item/quantity count]
      // 💰📦
      // 🏴‍☠️📦
      lootHeader: {
        left: last_beat.chests ? `${last_beat.chests} 📦` : "",
        middle: "Looted (12h)",
        right:
          last_beat.loot.length > 0
            ? `${last_beat.loot.reduce((a, val) => a + val.q, 0)}`
            : "",
      },
      loot: groupedLoot.map(([time, name, quantity]) => [time, name, quantity]),
    };
  });

  return ui;
}

function loadMinimapGeometry() {
  try {
    return require("bot-web-interface/minimapGeometry");
  } catch (e) {
    try {
      // Dev: sibling checkout when the installed tarball is stale.
      return require("../../bot-web-interface/minimapGeometry");
    } catch (e2) {
      console.warn(
        "caracAL: bot-web-interface/minimapGeometry missing — minimap disabled",
        e2 && e2.message
      );
      return null;
    }
  }
}
function loadCountdown() {
  try {
    return require("bot-web-interface/countdown");
  } catch (e) {
    try {
      return require("../../bot-web-interface/countdown");
    } catch (e2) {
      console.warn(
        "caracAL: bot-web-interface/countdown missing — timer presentation stubbed",
        e2 && e2.message
      );
      return {
        timerPresentation: () => ({ text: "", color: "#888" }),
      };
    }
  }
}
const mmapGeom = loadMinimapGeometry();
const MINIMAP_AVAILABLE = Boolean(mmapGeom);
const projectMinimapPoint = MINIMAP_AVAILABLE
  ? mmapGeom.projectMinimapPoint
  : () => [0, 0];
const resolveMinimapView = MINIMAP_AVAILABLE
  ? mmapGeom.resolveMinimapView
  : () => ({ width: 200, height: 150, scale: 1 / 3, vision: [700, 500] });
const DEFAULT_VISION = MINIMAP_AVAILABLE
  ? mmapGeom.DEFAULT_VISION
  : [700, 500];
const createWallProjector =
  MINIMAP_AVAILABLE && typeof mmapGeom.createWallProjector === "function"
    ? mmapGeom.createWallProjector
    : MINIMAP_AVAILABLE
      ? () => mmapGeom.projectMinimapLines
      : () => () => [];
const { timerPresentation } = loadCountdown();

const mmap_defaults = resolveMinimapView(DEFAULT_VISION);
const mmap_w = mmap_defaults.width;
const mmap_h = mmap_defaults.height;
const mmap_scale = mmap_defaults.scale;
/** Per-character wall projectors (GEO scan is the expensive bit). */
const wallProjectors = new Map();

function wallsForCharacter(name) {
  let fn = wallProjectors.get(name);
  if (!fn) {
    fn = createWallProjector();
    wallProjectors.set(name, fn);
  }
  return fn;
}

/**
 * Build a BWI-generic minimap payload (pixel-space lines + markers).
 * Window matches character.vision (AL half-extents, default 700×500).
 * Geometry projection must stay identical to BWI's minimapGeometry helper.
 * @returns {{ lines: Array, markers: Array, width: number, height: number, scale: number, vision: number[] }}
 */
function generate_minimap(game_context) {
  if (!MINIMAP_AVAILABLE || !game_context?.character) {
    return {
      lines: [],
      markers: [],
      title: game_context?.character?.name || "",
      map: game_context?.character?.map || "",
      origin: [0, 0],
      scale: 1 / 3,
      width: 200,
      height: 150,
      vision: DEFAULT_VISION,
    };
  }
  const markers = [];

  const g_char = game_context.character;
  const c_x = g_char.real_x;
  const c_y = g_char.real_y;
  const view = resolveMinimapView(g_char.vision || DEFAULT_VISION);
  const opts = {
    width: view.width,
    height: view.height,
    scale: view.scale,
  };

  const lines = wallsForCharacter(g_char.name || "?")(
    game_context.GEO,
    c_x,
    c_y,
    opts,
  );

  function push_marker(ent, style, withLabel) {
    const [r_x, r_y] = projectMinimapPoint(
      ent.real_x,
      ent.real_y,
      c_x,
      c_y,
      opts,
    );
    if (
      r_x < -2 ||
      r_x >= view.width + 2 ||
      r_y < -2 ||
      r_y >= view.height + 2
    ) {
      return;
    }
    const marker = [r_x, r_y, style];
    if (withLabel !== false) {
      const label = ent.name || ent.mtype || "";
      if (label) marker.push(label);
    }
    markers.push(marker);
  }

  for (let ent_id in game_context.entities) {
    const ent = game_context.entities[ent_id];
    if (ent.npc || ent.dead) {
      continue;
    }
    let style;
    if (ent.mtype) {
      style = (ent.target == g_char.name && "alert") || "foe";
    } else {
      style = "other";
    }
    push_marker(ent, style);
  }

  const trg = game_context.entities[g_char.target];
  if (trg && !trg.npc && !trg.dead) {
    // Ring only — name already comes from the entity marker above.
    push_marker(trg, "focus", false);
  }
  push_marker(g_char, "self");

  return {
    lines,
    markers,
    title: g_char.name || "",
    map: g_char.map || "",
    origin: [c_x, c_y],
    scale: view.scale,
    width: view.width,
    height: view.height,
    vision: view.vision,
  };
}

// utils, should perhaps live in another file?

const CLASS_COLOR = {
  merchant: "#7f7f7f",
  mage: "#3e6eed",
  warrior: "#f07f2f",
  priest: "#eb4d82",
  ranger: "#8a512b",
  paladin: "#a3b4b9",
  rogue: "#44b75c",
};

// https://stackoverflow.com/a/74456486
function timeAgo(date) {
  var seconds = Math.floor(
    (new Date().getTime() - new Date(date).getTime()) / 1000,
  );
  var interval = seconds / 31536000;
  if (interval > 1) return Math.floor(interval) + " years";
  interval = seconds / 2592000;
  if (interval > 1) return Math.floor(interval) + " months";
  interval = seconds / 86400;
  if (interval > 1) return Math.floor(interval) + " days";
  interval = seconds / 3600;
  if (interval > 1) return Math.floor(interval) + " hours";
  interval = seconds / 60;
  if (interval > 1) return Math.floor(interval) + " minutes";
  return Math.floor(seconds) + " seconds";
}

function getTitleName(itemInfo, G) {
  const titleKey = itemInfo.p;
  const titleName =
    titleKey && G.titles[titleKey] ? `${G.titles[titleKey].title}` : "";
  return titleName;
}

exports.create_monitor_ui = create_monitor_ui;
exports.register_stat_beat = register_stat_beat;
