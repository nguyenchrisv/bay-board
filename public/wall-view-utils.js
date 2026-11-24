// Wall view utilities: pure functions for square 720x720 display mode

const WALL_MODES = ["bart", "ferry", "bus", "fitness"];
const ROTATION_INTERVAL_MS = 15_000; // 15 seconds default

function isWallMode() {
  const params = new URLSearchParams(window.location.search);
  return params.get("wall") === "square";
}

function getWallModes(config) {
  const modes = ["bart"];
  if (config.ferry?.stops?.length > 0) modes.push("ferry");
  if (config.bus?.stops?.length > 0) modes.push("bus");
  if (config.strava?.enabled) modes.push("fitness");
  return modes;
}

function getNextModeIndex(currentIndex, modes) {
  return (currentIndex + 1) % modes.length;
}

function formatWallDestination(destination, maxTiles = 16) {
  return String(destination || "").slice(0, maxTiles);
}

function calculateTileSize(viewportWidth, viewportHeight, tileCount, gap = 2) {
  // Calculate tile size to fit exactly in viewport
  const availableWidth = viewportWidth - (tileCount - 1) * gap;
  return Math.floor(availableWidth / tileCount);
}

function calculateRowsForViewport(viewportHeight, tileHeight, headerHeight = 60, gap = 8) {
  const availableHeight = viewportHeight - headerHeight - gap;
  const rows = Math.floor(availableHeight / tileHeight);
  // Cap at 5 rows for wall view readability
  return Math.min(rows, 5);
}

function getRotationInterval(config) {
  return config.wallRotationMs || ROTATION_INTERVAL_MS;
}

export {
  isWallMode,
  getWallModes,
  getNextModeIndex,
  formatWallDestination,
  calculateTileSize,
  calculateRowsForViewport,
  getRotationInterval,
  ROTATION_INTERVAL_MS,
};