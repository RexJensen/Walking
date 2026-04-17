const OSRM_BASE = "https://router.project-osrm.org";
const EARTH_RADIUS_M = 6371000;
const MAX_SNAP_METERS = 60;   // reject waypoints that don't snap onto a walkable way
const MAX_DETOUR_RATIO = 2.4; // reject routes that wander far vs. straight-line sum
const MAX_ATTEMPTS = 14;

const MANHATTAN_BOUNDS = {
  south: 40.6981, north: 40.8820,
  west: -74.0194, east: -73.9067,
};

const els = {
  date: document.getElementById("date"),
  locate: document.getElementById("locate"),
  locateLabel: document.getElementById("locate-label"),
  locStatus: document.getElementById("location-status"),
  minutes: document.getElementById("minutes"),
  minDisplay: document.getElementById("min-display"),
  manhattan: document.getElementById("manhattan-only"),
  generate: document.getElementById("generate"),
  generateLabel: document.getElementById("generate-label"),
  mapCard: document.getElementById("map-card"),
  summary: document.getElementById("summary"),
};

let map = null;
let startMarker = null;
let routeLayer = null;
let origin = null;

// ---------- masthead date ----------
(function setDate() {
  const d = new Date();
  const fmt = d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  els.date.textContent = fmt;
})();

// ---------- slider fill ----------
function updateSlider() {
  const v = +els.minutes.value;
  const min = +els.minutes.min;
  const max = +els.minutes.max;
  const pct = ((v - min) / (max - min)) * 100;
  els.minutes.style.setProperty("--fill", pct + "%");
  els.minDisplay.textContent = v;
}
els.minutes.addEventListener("input", updateSlider);
updateSlider();

// ---------- geo helpers ----------
const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;

function offsetPoint(lat, lon, distanceMeters, bearingDeg) {
  const bearing = toRad(bearingDeg);
  const latRad = toRad(lat);
  const lonRad = toRad(lon);
  const d = distanceMeters / EARTH_RADIUS_M;
  const newLat = Math.asin(
    Math.sin(latRad) * Math.cos(d) + Math.cos(latRad) * Math.sin(d) * Math.cos(bearing)
  );
  const newLon =
    lonRad +
    Math.atan2(
      Math.sin(bearing) * Math.sin(d) * Math.cos(latRad),
      Math.cos(d) - Math.sin(latRad) * Math.sin(newLat)
    );
  return [toDeg(newLat), ((toDeg(newLon) + 540) % 360) - 180];
}

function haversine(a, b) {
  const dLat = toRad(b[0] - a[0]);
  const dLon = toRad(b[1] - a[1]);
  const la1 = toRad(a[0]);
  const la2 = toRad(b[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

function inManhattan(lat, lon) {
  return (
    lat >= MANHATTAN_BOUNDS.south &&
    lat <= MANHATTAN_BOUNDS.north &&
    lon >= MANHATTAN_BOUNDS.west &&
    lon <= MANHATTAN_BOUNDS.east
  );
}

// ---------- geolocation ----------
function getLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation is not supported by this browser."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve([pos.coords.latitude, pos.coords.longitude]),
      (err) => reject(new Error(err.message || "Could not get location.")),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
    );
  });
}

els.locate.addEventListener("click", async () => {
  els.locate.disabled = true;
  els.locStatus.textContent = "Locating\u2026";
  try {
    origin = await getLocation();
    els.locateLabel.textContent = `${origin[0].toFixed(4)}, ${origin[1].toFixed(4)}`;
    els.locate.classList.add("located");
    els.locStatus.textContent = "Location set. Change duration and generate.";
  } catch (e) {
    els.locStatus.textContent = e.message;
  } finally {
    els.locate.disabled = false;
  }
});

// ---------- routing ----------
async function fetchRoute(points) {
  const coords = points.map(([lat, lon]) => `${lon},${lat}`).join(";");
  const url = `${OSRM_BASE}/route/v1/foot/${coords}?overview=full&geometries=geojson&steps=false`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Routing failed: ${res.status}`);
  const data = await res.json();
  if (!data.routes?.length) throw new Error("No route found.");
  return { route: data.routes[0], waypoints: data.waypoints || [] };
}

function candidateInBounds(origin, wp1, wp2, constrainManhattan) {
  if (!constrainManhattan) return true;
  return (
    inManhattan(origin[0], origin[1]) &&
    inManhattan(wp1[0], wp1[1]) &&
    inManhattan(wp2[0], wp2[1])
  );
}

async function buildLoop(origin, targetSeconds, speedMps, constrainManhattan) {
  const targetDistance = speedMps * targetSeconds;
  let best = null;
  let bestScore = Infinity;
  let scale = 1;
  let accepted = 0;

  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const legFraction = 0.28 + Math.random() * 0.08;
    const leg = targetDistance * scale * legFraction;
    const b1 = Math.random() * 360;
    const turn = 80 + Math.random() * 80;
    const sign = Math.random() < 0.5 ? 1 : -1;
    const b2 = b1 + sign * turn;

    const wp1 = offsetPoint(origin[0], origin[1], leg, b1);
    const wp2 = offsetPoint(wp1[0], wp1[1], leg, b2);

    if (!candidateInBounds(origin, wp1, wp2, constrainManhattan)) continue;

    els.generateLabel.textContent = `Scouting\u2026 ${i + 1}/${MAX_ATTEMPTS}`;

    let result;
    try {
      result = await fetchRoute([origin, wp1, wp2, origin]);
    } catch (_) {
      continue;
    }

    const { route, waypoints } = result;

    // Walkability: every waypoint must snap close to a walkable way.
    const maxSnap = Math.max(...waypoints.map((w) => w?.distance ?? 0));
    if (maxSnap > MAX_SNAP_METERS) continue;

    // Detour sanity: route distance shouldn't dwarf the straight-line plan.
    const straight =
      haversine(origin, wp1) + haversine(wp1, wp2) + haversine(wp2, origin);
    if (straight > 0 && route.distance / straight > MAX_DETOUR_RATIO) continue;

    // Duration sanity: discard routes that are wildly off (OSRM foot speed
    // assumptions can differ; we'll rescale and try again).
    const durDiff = Math.abs(route.duration - targetSeconds);
    const ratio = route.duration / targetSeconds;
    if (ratio < 0.5 || ratio > 1.8) {
      scale *= targetSeconds / route.duration;
      scale = Math.max(0.4, Math.min(2.0, scale));
      continue;
    }

    accepted++;
    if (durDiff < bestScore) {
      bestScore = durDiff;
      best = route;
    }
    if (durDiff / targetSeconds < 0.1 && accepted >= 2) break;

    // Nudge scale toward target for the next try.
    scale *= targetSeconds / route.duration;
    scale = Math.max(0.5, Math.min(1.6, scale));
  }

  return best;
}

// ---------- main ----------
function ensureMap() {
  if (map) return;
  els.mapCard.hidden = false;
  map = L.map("map", { zoomControl: true }).setView(origin, 15);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
  }).addTo(map);
}

els.generate.addEventListener("click", async () => {
  if (!origin) {
    els.locStatus.textContent = "Set your starting point first.";
    return;
  }

  const minutes = +els.minutes.value;
  const speedMps = (5 * 1000) / 3600; // 5 km/h
  const targetSeconds = minutes * 60;
  const constrainManhattan = els.manhattan.checked;

  if (constrainManhattan && !inManhattan(origin[0], origin[1])) {
    els.locStatus.textContent =
      "Your location isn't in Manhattan. Uncheck the constraint or move.";
    return;
  }

  els.generate.disabled = true;
  els.generateLabel.textContent = "Scouting routes\u2026";

  const best = await buildLoop(origin, targetSeconds, speedMps, constrainManhattan);

  if (!best) {
    els.generateLabel.textContent = "No walkable loop found \u2014 try again";
    els.generate.disabled = false;
    return;
  }

  ensureMap();
  map.invalidateSize();

  if (startMarker) startMarker.remove();
  startMarker = L.marker(origin).addTo(map).bindPopup("Start / End");

  if (routeLayer) routeLayer.remove();
  routeLayer = L.geoJSON(best.geometry, {
    style: { color: "#e35a29", weight: 5, opacity: 0.95 },
  }).addTo(map);
  map.fitBounds(routeLayer.getBounds(), { padding: [30, 30] });

  const mins = Math.round(best.duration / 60);
  const km = (best.distance / 1000).toFixed(2);
  const mi = (best.distance / 1609.344).toFixed(2);
  els.summary.textContent = `\u201C${mins} minutes \u00b7 ${km} km (${mi} mi)\u201D`;

  els.generateLabel.textContent = "Generate another";
  els.generate.disabled = false;

  els.mapCard.scrollIntoView({ behavior: "smooth", block: "start" });
});
