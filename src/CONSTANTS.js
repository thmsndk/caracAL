module.exports = {
  COORDINATOR_MODULE_PATH: "./standalones/CharacterCoordinator.js",
  CONFIG_EXAMPLE_PATH: "./config.EXAMPLE.js",
  LOCALSTORAGE_PATH: "./localStorage/caraGarage.jsonl",
  LOCALSTORAGE_ROTA_PATH: "./localStorage/caraGarage.other.jsonl",
  STAT_BEAT_INTERVAL: 500,
  /** Redeploy when an enabled character stops sending stat_beat this long. */
  STALE_STAT_BEAT_MS: 30_000,
  CHAR_WATCHDOG_INTERVAL_MS: 5_000,
};
