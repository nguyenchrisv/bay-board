// Split-flap utilities: pure functions for color mapping, minutes formatting, and character diffing

// Destination column shows at most this many split-flap tiles per row
const MAX_DEST_TILES = 12;

// Cap a destination at maxTiles characters (no padding). Long names like
// "Dublin/Pleasanton" otherwise overflow into the MIN column. Narrow
// screens render 10 tiles instead of 12 (see app.js destCap), so the cap
// is a parameter.
function formatDestination(destination, maxTiles = MAX_DEST_TILES) {
  return String(destination || "").slice(0, maxTiles);
}

// Short visual label for the line chip (e.g. "Yellow" -> "Yel"). The
// accessible name ("Green line") is kept separately via aria-label.
function chipLabel(line) {
  return String(line || "").slice(0, 3);
}

// BART line color to name mapping
const COLOR_NAMES = {
  "#ff0000": "Red",
  "#ff9933": "Orange",
  "#ffff33": "Yellow",
  "#339933": "Green",
  "#0099cc": "Blue",
  "#c463c5": "Purple",
  "#d5cfa3": "Beige",
};

function getLineNameFromColor(color) {
  if (!color) return "Line";
  const normalized = color.toLowerCase();
  return COLOR_NAMES[normalized] || "Line";
}

function formatMinutes(minutes) {
  if (minutes === 0) return "NOW";
  if (minutes === undefined || minutes === null) return "";
  return String(minutes);
}

function getAccessibleLabel(dep) {
  const lineName = getLineNameFromColor(dep.color);
  const destination = dep.destination || "Unknown";
  const minutes = formatMinutes(dep.minutes);
  const platform = dep.platform || dep.remarks || "";
  const platformStr = platform ? ", platform " + platform : "";
  return lineName + " line to " + destination + ", " + minutes + " minutes" + platformStr;
}

function diffStrings(oldStr, newStr) {
  // Returns array of indices where characters differ
  const maxLen = Math.max(oldStr.length, newStr.length);
  const changes = [];
  for (let i = 0; i < maxLen; i++) {
    const oldChar = oldStr[i] || "";
    const newChar = newStr[i] || "";
    if (oldChar !== newChar) {
      changes.push(i);
    }
  }
  return changes;
}

// tileCount: how many tiles the CSS size formula should assume for this
// cell (see style.css --tile). Defaults to the actual character count so
// MIN/PLAT tiles fill their own columns; the destination cell passes its
// cap (12 or 10) so every destination row shares one tile size.
function createSplitFlapCell(text, changedIndices = [], cellClass = "", tileCount = null) {
  const td = document.createElement("td");
  td.className = cellClass ? `split-flap-cell ${cellClass}` : "split-flap-cell";

  // Create a container for the split-flap tiles
  const container = document.createElement("div");
  container.className = "split-flap-container";

  const chars = text.split("");
  container.style.setProperty(
    "--tiles",
    String(tileCount ?? Math.max(chars.length, 1))
  );
  chars.forEach((char, index) => {
    const tile = document.createElement("div");
    tile.className = "split-flap-tile";
    tile.style.setProperty("--char-index", index);
    tile.setAttribute("aria-hidden", "true");

    const top = document.createElement("div");
    top.className = "split-flap-half top";
    const topInner = document.createElement("span");
    topInner.className = "char-inner";
    topInner.textContent = char;
    top.appendChild(topInner);

    const bottom = document.createElement("div");
    bottom.className = "split-flap-half bottom";
    const bottomInner = document.createElement("span");
    bottomInner.className = "char-inner";
    bottomInner.textContent = char;
    bottom.appendChild(bottomInner);

    const hinge = document.createElement("div");
    hinge.className = "split-flap-hinge";

    tile.appendChild(top);
    tile.appendChild(hinge);
    tile.appendChild(bottom);

    if (changedIndices.includes(index)) {
      tile.classList.add("flipping");
      // Remove flipping class after animation completes
      setTimeout(() => {
        tile.classList.remove("flipping");
      }, 600);
    }

    container.appendChild(tile);
  });

  td.appendChild(container);
  return td;
}

function createLineChipCell(dep) {
  const td = document.createElement("td");
  td.className = "line-chip-cell";

  const chip = document.createElement("span");
  chip.className = "line-chip";
  if (dep.color) {
    chip.style.backgroundColor = dep.color;
  }
  chip.textContent = chipLabel(dep.line);
  chip.setAttribute("aria-label", getLineNameFromColor(dep.color) + " line");

  td.appendChild(chip);
  return td;
}

function createDestinationCell(dep) {
  const td = document.createElement("td");
  td.className = "destination-cell";
  td.textContent = dep.destination || "";
  return td;
}

function createMinutesCell(dep) {
  const td = document.createElement("td");
  td.className = "minutes-cell";
  const minutes = formatMinutes(dep.minutes);
  td.textContent = minutes;
  if (minutes === "NOW") {
    td.classList.add("boarding");
  }
  return td;
}

function createPlatformCell(dep) {
  const td = document.createElement("td");
  td.className = "platform-cell";
  td.textContent = dep.platform || dep.remarks || "";
  return td;
}

export {
  getLineNameFromColor,
  formatMinutes,
  getAccessibleLabel,
  diffStrings,
  formatDestination,
  chipLabel,
  createSplitFlapCell,
  createLineChipCell,
  createDestinationCell,
  createMinutesCell,
  createPlatformCell,
};
