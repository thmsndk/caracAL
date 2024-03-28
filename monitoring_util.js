const prettyMilliseconds = require("pretty-ms");
const { PNG } = require("pngjs");
const { STAT_BEAT_INTERVAL } = require("./src/CONSTANTS.js");
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
  var item = lookup.find(function (item) {
    return abs(num) < item.value;
  });
  return item
    ? ((num * 1e3) / item.value).toFixed(digits).replace(rx, "$1") + item.symbol
    : num.toExponential(digits);
}

function register_stat_beat(game_context) {
  // TODO: register a loot / drop handler so we can display what we looted

  function scqMapGData(propKey, props) {
    switch (propKey) {
      case "s":
        // s is conditions or buffs
        if (Object.keys(props).length === 0) return;

        const gConditions = game_context.G.conditions;
        const result = {};

        for (const key in props) {
          const prop = props[key];

          if (typeof prop === "boolean") {
            // TODO: should we map to the same data structure? it's not on a timer if it has no ms
            result[key] = prop;
          } else {
            const gCondition = gConditions[prop.name];
            const newProp = { ...prop };
            newProp.name = gCondition?.name ?? prop.name ?? key;
            newProp.ims =
              gCondition?.duration ?? 12000; /* citizen aura default ms */
            result[key] = newProp;
          }
        }

        return result;
    }

    // c is channeled actions, like fishing
    // "town": {"ms":3000}, // Set when "town" portal is in progress
    // "revival": {ms:8000,f:"PriestName"}, // Set when revival is in progress

    // q is progressed actions, upgrade, compound, exchange
    // "upgrade": {"ms":2000,"len":2000,"num":5}, // Item at inventory position #5 is being upgraded
    // "compound": {"ms":8000,"len":10000,"num":0}, // Item at inventory position #0 is being compounded
    // "exchange": {"ms":3000,name:"gem0","num":12}, // A "gem0" exchange is in progress

    return props;
  }

  game_context.caracAL.stat_beat = setInterval(() => {
    const character = game_context.character;
    const result = { type: "stat_beat" };

    const entityProps = [
      "id",
      "name",
      "type",
      "mtype",
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
    ];

    // console.log(character);
    [...entityProps, "gold", "isize", "esize"].forEach((x) => {
      if (x === "type") return; // don't override result.type, it's the message type
      // create_monitor_ui does not have the game_context, so we look up values here
      const propValue = scqMapGData(x, character[x]);
      result[x] = propValue;
    });

    const targeting = game_context.entities[character.target];
    if (targeting) {
      result.target = {};
      entityProps.forEach((x) => {
        // create_monitor_ui does not have the game_context, so we look up values here
        const propValue = scqMapGData(x, targeting[x]);
        result.target[x] = propValue;
      });
    } else {
      // target not in entities
      delete result.target;
    }

    result.current_status = game_context.current_status;
    if (game_context.caracAL.map_enabled()) {
      result.mmap =
        "data:image/png;base64," +
        generate_minimap(game_context).toString("base64");
    }
    // console.warn("stat beat send");
    process.send(result);
  }, STAT_BEAT_INTERVAL);
}

// child_block is a child process with a stat beat
function create_monitor_ui(bwi, char_name, child_block, enable_map) {
  let xp_histo = [];
  let xp_ph = 0;
  let gold_histo = [];
  let last_beat = null;

  // .instance is the process, I don't think we have access to the game context here
  // console.log(child_block.instance.)

  // register_stat_beat will trigger a specific message
  child_block.instance.on("message", (m) => {
    if (m.type == "stat_beat") {
      // console.warn("stat_beat", m);
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
    }
  });

  function quick_bar_val(num, denom, humanize = false) {
    let modif = (x) => x;
    if (humanize) {
      modif = (x) => humanize_int(x, 1);
    }
    return [(100 * num) / denom, `${modif(num)}/${modif(denom)}`];
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

  const schema = [
    { name: "name", type: "text", label: "Name", getter: () => char_name },
    {
      name: "realm",
      type: "text",
      label: "Realm",
      getter: () => child_block.realm,
    },
    {
      name: "not_rip",
      type: "text",
      label: "Alive",
      getter: () => (last_beat.rip && "No") || "Yes",
    },
    {
      name: "level",
      type: "text",
      label: "Level",
      getter: () => last_beat.level,
    },
    {
      name: "health",
      type: "labelProgressBar",
      label: "Health",
      options: { color: "red" },
      getter: () => quick_bar_val(last_beat.hp, last_beat.max_hp),
    },
    {
      name: "mana",
      type: "labelProgressBar",
      label: "Mana",
      options: { color: "blue" },
      getter: () => quick_bar_val(last_beat.mp, last_beat.max_mp),
    },
    {
      name: "xp",
      type: "labelProgressBar",
      label: "XP",
      options: { color: "green" },
      getter: () => quick_bar_val(last_beat.xp, last_beat.max_xp, true),
    },
    {
      name: "inv",
      type: "labelProgressBar",
      label: "Inventory",
      options: { color: "brown" },
      getter: () =>
        quick_bar_val(last_beat.isize - last_beat.esize, last_beat.isize),
    },
    {
      name: "gold",
      type: "text",
      label: "Gold",
      getter: () => humanize_int(last_beat.gold, 1),
    },
    {
      name: "party_leader",
      type: "text",
      label: "Chief",
      getter: () => last_beat.party || "N/A",
    },
    {
      name: "current_status",
      type: "text",
      label: "Status",
      getter: () => last_beat.current_status,
    },
    {
      name: "target",
      type: "text",
      label: "Target",
      getter: () =>
        (last_beat.t_name &&
          (last_beat.mtype ? "Player " : "") + last_beat.t_name) ||
        "None",
    },
    {
      name: "gph",
      type: "text",
      label: "Gold/h",
      getter: () => humanize_int(val_ph(gold_histo), 1),
    },
    {
      name: "xpph",
      type: "text",
      label: "XP/h",
      getter: () => humanize_int(xp_ph, 1),
    },
    {
      name: "ttlu",
      type: "text",
      label: "TTLU",
      getter: () =>
        (xp_ph <= 0 && "N/A") ||
        prettyMilliseconds(
          ((last_beat.max_xp - last_beat.xp) * 3600000) / xp_ph,
          { unitCount: 2 },
        ),
    },
  ];

  if (enable_map) {
    schema.push({
      name: "minimap",
      type: "image",
      label: "Map",
      options: { width: mmap_w, height: mmap_h },
      getter: () => last_beat.mmap,
    });
  }

  // main interface
  const ui = bwi.publisher.createInterface(
    [
      { name: "character", type: "botUI" },
      { name: "target", type: "botUI" },
      // TODO: minimap? before or after loot? before target?
      { name: "loot", type: "botUI" },
    ],
    // schema.map((x) => ({
    //   name: x.name,
    //   type: x.type,
    //   label: x.label,
    //   options: x.options,
    // })),
  );

  // TODO: show realm / server
  let characterBotUI = ui.createSubBotUI(
    [
      // [characterName] [status] [level]
      { name: "header", type: "leftMiddleRightText" },
      // TODO: last N status messages?
      // TODO: Party Leader?
      // TODO: party stats?
      // TODO: current map?
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
        // TODO: render TTLU on right side, need a new component for that
      },
      { name: "xpText", type: "leftMiddleRightText" },
      {
        name: "inv",
        type: "labelProgressBar",
        label: "Inventory",
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
    ],
    "character",
  );

  function scqTimers(s, c, q) {
    // s is conditions or buffs
    // TODO: how do we access G? is it even possible? would like to look up the name and duration
    // G.conditions has stat information on most conditions
    // If a condition isn't present, it will likely not be in "s"
    // "ms" is milliseconds left
    // "cursed": {"ms":400},
    // "mluck": {"ms":120000,"f":"MerchantName"},
    // "citizen0aura": {"ms":12000,"name":"Citizen's Aura","skin":"citizensaura","luck":100},
    // ^ an example of a dynamically generated status that's not on G.conditions
    // "invis": false,
    // c is channeled actions, like fishing
    // q is progressed actions, upgrade, compound, exchange
  }

  characterBotUI.setDataSource(() => {
    if (!last_beat) {
      return {
        // [characterName] [status] [level]
        header: { left: char_name, middle: "Loading...", right: "" },
      };
    }

    return {
      header: {
        left: char_name,
        middle: last_beat.rip ? "💀" : last_beat.current_status,
        right: last_beat.level,
      },
      health: quick_bar_val(last_beat.hp, last_beat.max_hp),
      mana: quick_bar_val(last_beat.mp, last_beat.max_mp),
      xp: quick_bar_val(last_beat.xp, last_beat.max_xp, true),
      xpText: {
        left: `XP/h ${humanize_int(xp_ph, 1)}`,
        middle: "",
        right: `${
          (xp_ph <= 0 && "N/A") ||
          prettyMilliseconds(
            ((last_beat.max_xp - last_beat.xp) * 3600000) / xp_ph,
            { unitCount: 2 },
          )
        } TTLU`,
      },
      inv: quick_bar_val(last_beat.isize - last_beat.esize, last_beat.isize),
      gold: {
        left: `Gold: ${humanize_int(last_beat.gold, 1)}`,
        middle: "",
        right: `${humanize_int(val_ph(gold_histo), 1)} G/h`,
      },
      // timers: last_beat.s,
    };
  });

  let targetBotUI = ui.createSubBotUI(
    [
      { name: "header", type: "leftMiddleRightText" },
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
      };
    }

    return {
      header: {
        left: entity.name,
        middle: entity.rip ? "💀" : entity.target ?? "",
        right: entity.level,
      },
      health: quick_bar_val(entity.hp, entity.max_hp),
      mana: quick_bar_val(entity.mp, entity.max_mp),
      // timers: entity.s,
    };
  });
  // ui.setDataSource(() => {
  //   if (!last_beat) {
  //     return {
  //       name: char_name,
  //       realm: child_block.realm,
  //       not_rip: "Hopefully",
  //       current_status: "Loading...",
  //     };
  //   }
  //   const result = {};
  //   schema.forEach((x) => (result[x.name] = x.getter()));
  //   return result;
  // });
  // TODO: return something that can call destroy on each interface
  return ui;
}

const mmap_cols = {
  //transparent
  background: [0, 0, 0, 0],
  //brown
  monster: [0xb1, 0x4f, 0x1d, 255],
  //light red
  monster_engaged: [0xc1, 0x00, 0x37, 255],
  //dark blue
  character: [50, 177, 245, 255],
  //light blue
  player: [40, 74, 244, 255],
  //gray
  wall: [200, 200, 200, 255],
};
const mmap_w = 200;
const mmap_h = 150;
const mmap_scale = 1 / 3;

function generate_minimap(game_context) {
  var png = new PNG({
    width: mmap_w,
    height: mmap_h,
    filterType: -1,
  });
  const i_data = png.data;
  function fill_rect(x1, y1, x2, y2, col) {
    for (let i = x1; i < x2; i++) {
      for (let j = y1; j < y2; j++) {
        const idd = (mmap_w * j + i) << 2;
        i_data[idd] = col[0];
        i_data[idd + 1] = col[1];
        i_data[idd + 2] = col[2];
        i_data[idd + 3] = col[3];
      }
    }
  }
  function safe_fill_rect(x1, y1, x2, y2, col) {
    x1 = max(0, min(x1, mmap_w));
    x2 = max(0, min(x2, mmap_w));
    y1 = max(0, min(y1, mmap_h));
    y2 = max(0, min(y2, mmap_h));
    fill_rect(x1, y1, x2, y2, col);
  }
  const g_char = game_context.character;
  const c_x = g_char.real_x;
  const c_y = g_char.real_y;
  function relative_coords(x, y) {
    return [
      (x - c_x) * mmap_scale + mmap_w / 2,
      (y - c_y) * mmap_scale + mmap_h / 2,
    ];
  }

  //fill with bg data
  fill_rect(0, 0, mmap_w, mmap_h, mmap_cols.background);

  const geom = game_context.GEO;
  //draw horizontal collision
  for (let i = 0; i < geom.x_lines.length; i++) {
    //raw line data
    const [r_x, r_y1, r_y2] = geom.x_lines[i];
    const l_x = floor((r_x - c_x) * mmap_scale + mmap_w / 2);
    if (l_x < 0) continue;
    if (l_x >= mmap_w) break;
    safe_fill_rect(
      l_x,
      floor((r_y1 - c_y) * mmap_scale + mmap_h / 2),
      l_x + 1,
      floor((r_y2 - c_y) * mmap_scale + mmap_h / 2) + 1,
      mmap_cols.wall,
    );
  }
  //draw vertical collision
  for (let i = 0; i < geom.y_lines.length; i++) {
    //raw line data
    const [r_y, r_x1, r_x2] = geom.y_lines[i];
    const l_y = floor((r_y - c_y) * mmap_scale + mmap_h / 2);
    if (l_y < 0) continue;
    if (l_y >= mmap_h) break;

    safe_fill_rect(
      floor((r_x1 - c_x) * mmap_scale + mmap_w / 2),
      l_y,
      floor((r_x2 - c_x) * mmap_scale + mmap_w / 2) + 1,
      l_y + 1,
      mmap_cols.wall,
    );
  }

  function draw_blip(ent, col) {
    const rel = relative_coords(ent.real_x, ent.real_y);
    const r_x = floor(rel[0]);
    const r_y = floor(rel[1]);
    safe_fill_rect(r_x - 1, r_y, r_x + 2, r_y + 1, col);
    safe_fill_rect(r_x, r_y - 1, r_x + 1, r_y + 2, col);
  }
  function pixel_circle(ent, col) {
    const rel = relative_coords(ent.real_x, ent.real_y);
    const r_x = floor(rel[0]);
    const r_y = floor(rel[1]);
    safe_fill_rect(r_x - 1, r_y - 3, r_x + 2, r_y - 2, col);
    safe_fill_rect(r_x - 1, r_y + 3, r_x + 2, r_y + 4, col);
    safe_fill_rect(r_x - 3, r_y - 1, r_x - 2, r_y + 2, col);
    safe_fill_rect(r_x + 3, r_y - 1, r_x + 4, r_y + 2, col);

    safe_fill_rect(r_x - 2, r_y - 2, r_x - 1, r_y - 1, col);
    safe_fill_rect(r_x + 2, r_y + 2, r_x + 3, r_y + 3, col);
    safe_fill_rect(r_x + 2, r_y - 2, r_x + 3, r_y - 1, col);
    safe_fill_rect(r_x - 2, r_y + 2, r_x - 1, r_y + 3, col);
  }

  //draw entities
  for (let ent_id in game_context.entities) {
    const ent = game_context.entities[ent_id];
    if (ent.npc || ent.dead) {
      continue;
    }
    let color;
    if (ent.mtype) {
      color =
        (ent.target == g_char.name && mmap_cols.monster_engaged) ||
        mmap_cols.monster;
    } else {
      color = mmap_cols.player;
    }
    draw_blip(ent, color);
  }

  const trg = game_context.entities[g_char.target];
  if (trg && !trg.npc && !trg.dead) {
    pixel_circle(trg, mmap_cols.monster_engaged);
  }
  draw_blip(g_char, mmap_cols.character);

  return PNG.sync.write(png);
}

exports.create_monitor_ui = create_monitor_ui;
exports.register_stat_beat = register_stat_beat;
