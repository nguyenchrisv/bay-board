// BART adapter: pure functions to transform raw BART API JSON into normalized board shape

const STATION_NAMES = {
  "12TH": "12th St Oakland City Center",
  "16TH": "16th St Mission",
  "19TH": "19th St Oakland",
  "24TH": "24th St Mission",
  "ASHB": "Ashby",
  "BALB": "Balboa Park",
  "BAYF": "Bay Fair",
  "CAST": "Castro Valley",
  "CIVC": "Civic Center",
  "COLS": "Coliseum",
  "COLM": "Colma",
  "CONC": "Concord",
  "DALY": "Daly City",
  "DBRK": "Downtown Berkeley",
  "DUBL": "Dublin/Pleasanton",
  "DELN": "El Cerrito del Norte",
  "PLZA": "El Cerrito Plaza",
  "EMBR": "Embarcadero",
  "FRMT": "Fremont",
  "FTVL": "Fruitvale",
  "GLEN": "Glen Park",
  "HAYW": "Hayward",
  "LAFY": "Lafayette",
  "LAKE": "Lake Merritt",
  "MCAR": "MacArthur",
  "MLBR": "Millbrae",
  "MONT": "Montgomery",
  "NBRK": "North Berkeley",
  "NCON": "North Concord/Martinez",
  "OAKL": "Oakland Int'l Airport",
  "ORIN": "Orinda",
  "PITT": "Pittsburg/Bay Point",
  "PHIL": "Pleasant Hill",
  "POWL": "Powell St",
  "RICH": "Richmond",
  "ROCK": "Rockridge",
  "SBRN": "San Bruno",
  "SFIA": "San Francisco Int'l Airport",
  "SANL": "San Leandro",
  "SHAY": "South Hayward",
  "SSAN": "South San Francisco",
  "UCTY": "Union City",
  "WCRK": "Walnut Creek",
  "WDUB": "West Dublin",
  "WOAK": "West Oakland",
};

function getStationName(abbr) {
  return STATION_NAMES[abbr] || abbr;
}

function parseMinutes(minutesStr) {
  if (!minutesStr) return null;
  const trimmed = minutesStr.trim().toLowerCase();
  if (trimmed === "leaving") return 0;
  const num = parseInt(trimmed, 10);
  return Number.isNaN(num) ? null : num;
}

function normalizeEtd(rawJson) {
  // Handle empty or missing root
  if (!rawJson || !rawJson.root || !rawJson.root.station) {
    return { station: null, departures: [] };
  }

  const stations = Array.isArray(rawJson.root.station) ? rawJson.root.station : [rawJson.root.station];
  const station = stations[0]; // We query one station at a time

  if (!station || !station.etd) {
    return { station: getStationName(station?.abbr), departures: [] };
  }

  const etdList = Array.isArray(station.etd) ? station.etd : [station.etd];
  const departures = [];

  for (const etd of etdList) {
    const destination = etd.destination || "";
    const estimates = Array.isArray(etd.estimate) ? etd.estimate : [etd.estimate];

    for (const est of estimates) {
      const minutes = parseMinutes(est.minutes);
      if (minutes === null) continue; // Skip invalid

      const line = etd.abbreviation || destination; // Use abbreviation as line identifier
      const color = est.hexcolor || est.color ? `#${est.color || est.hexcolor}` : "#ffff33";

      departures.push({
        line,
        destination,
        minutes,
        platform: est.platform || "",
        color,
        remarks: "",
      });
    }
  }

  // Sort by minutes ascending
  departures.sort((a, b) => a.minutes - b.minutes);

  return {
    station: getStationName(station.abbr),
    departures,
  };
}

function normalizeAdvisories(rawJson) {
  if (!rawJson || !rawJson.root || !rawJson.root.bsa) {
    return [];
  }

  const bsaList = Array.isArray(rawJson.root.bsa) ? rawJson.root.bsa : [rawJson.root.bsa];
  const advisories = [];

  for (const bsa of bsaList) {
    if (bsa.description) {
      advisories.push(bsa.description);
    }
  }

  return advisories;
}

export { normalizeEtd, normalizeAdvisories, getStationName, parseMinutes };
