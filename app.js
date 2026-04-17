const OSRM_BASE = "https://router.project-osrm.org/route/v1/foot";
const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const EARTH_RADIUS_M = 6371000;
const WALK_PACE_KMH = 5;

const map = L.map("map", { zoomControl: false }).setView([39.5, -98.35], 4);
L.control.zoom({ position: "bottomright" }).addTo(map);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 19,
}).addTo(map);

let startMarker = null;
let routeLayer = null;
let origin = null;

const durationEl = document.getElementById("duration");
const durationNumberEl = document.getElementById("duration-number");
const locationInput = document.getElementById("location-input");
const locationSearchBtn = document.getElementById("location-search");
const useLocationBtn = document.getElementById("use-location");
const locationStatusEl = document.getElementById("location-status");
const generateBtn = document.getElementById("generate");
const summaryEl = document.getElementById("summary");
const panelToggle = document.getElementById("panel-toggle");
const issueNumberEl = document.getElementById("issue-number");
const todayDateEl = document.getElementById("today-date");

initDate();
initIssueNumber();
initDurationSlider();
initPanelToggle();
locationSearchBtn.addEventListener("click", searchLocation);
locationInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); searchLocation(); } });
useLocationBtn.addEventListener("click", useCurrentLocation);
generateBtn.addEventListener("click", generate);

function initDate() {
  const d = new Date();
  const fmt = d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  todayDateEl.textContent = fmt;
}

function initIssueNumber() {
  const d = new Date();
  const start = new Date(d.getFullYear(), 0, 0);
  const day = Math.floor((d - start) / 86400000);
  issueNumberEl.textContent = String(day).padStart(3, "0");
}

function initDurationSlider() {
  const update = () => {
    const v = parseInt(durationEl.value, 10);
    durationNumberEl.textContent = v;
    const pct = ((v - durationEl.min) / (durationEl.max - durationEl.min)) * 100;
    durationEl.style.background =
      `linear-gradient(to right, var(--accent) 0%, var(--accent) ${pct}%, #d7d1c5 ${pct}%, #d7d1c5 100%)`;
  };
  durationEl.addEventListener("input", update);
  update();
}

function initPanelToggle() {
  panelToggle.addEventListener("click", () => {
    document.body.classList.toggle("panel-collapsed");
    setTimeout(() => map.invalidateSize(), 320);
  });
}

function setStatus(msg) { locationStatusEl.textContent = msg || ""; }

function toRad(deg) { return (deg * Math.PI) / 180; }
function toDeg(rad) { return (rad * 180) / Math.PI; }

function offsetPoint(lat, lon, distanceMeters, bearingDeg) {
  const bearing = toRad(bearingDeg);
  const latRad = toRad(lat);
  const lonRad = toRad(lon);
  const d = distanceMeters / EARTH_RADIUS_M;
  const newLat = Math.asin(
    Math.sin(latRad) * Math.cos(d) + Math.cos(latRad) * Math.sin(d) * Math.cos(bearing)
  );
  const newLon = lonRad + Math.atan2(
    Math.sin(bearing) * Math.sin(d) * Math.cos(latRad),
    Math.cos(d) - Math.sin(latRad) * Math.sin(newLat)
  );
  return [toDeg(newLat), ((toDeg(newLon) + 540) % 360) - 180];
}

function setOrigin(lat, lon, label) {
  origin = [lat, lon];
  if (startMarker) startMarker.remove();
  startMarker = L.marker(origin).addTo(map);
  if (label) startMarker.bindPopup(label);
  map.setView(origin, 15);
  setStatus(label ? `Pinned: ${label}` : "Location set");
}

async function searchLocation() {
  const q = locationInput.value.trim();
  if (!q) { setStatus("Enter a place to search"); return; }
  setStatus("Searching\u2026");
  try {
    const url = `${NOMINATIM}?q=${encodeURIComponent(q)}&format=json&limit=1`;
    const res = await fetch(url, { headers: { "Accept": "application/json" } });
    if (!res.ok) throw new Error(`Search failed: ${res.status}`);
    const results = await res.json();
    if (!results.length) { setStatus("No matches found"); return; }
    const r = results[0];
    setOrigin(parseFloat(r.lat), parseFloat(r.lon), r.display_name);
  } catch (e) {
    setStatus(e.message || "Search failed");
  }
}

function useCurrentLocation() {
  if (!navigator.geolocation) { setStatus("Geolocation not supported"); return; }
  setStatus("Getting your location\u2026");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      setOrigin(pos.coords.latitude, pos.coords.longitude, "Current location");
      locationInput.value = "";
    },
    (err) => setStatus(err.message || "Could not get location"),
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
  );
}

async function fetchRoute(points) {
  const coords = points.map(([lat, lon]) => `${lon},${lat}`).join(";");
  const url = `${OSRM_BASE}/${coords}?overview=full&geometries=geojson&steps=false`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Routing request failed: ${res.status}`);
  const data = await res.json();
  if (!data.routes || !data.routes.length) throw new Error("No route found.");
  return data.routes[0];
}

function buildLoopCandidate(start, targetDistanceM) {
  const legFraction = 0.28 + Math.random() * 0.08;
  const leg = targetDistanceM * legFraction;
  const b1 = Math.random() * 360;
  const turn = 80 + Math.random() * 80;
  const sign = Math.random() < 0.5 ? 1 : -1;
  const b2 = b1 + sign * turn;
  const wp1 = offsetPoint(start[0], start[1], leg, b1);
  const wp2 = offsetPoint(wp1[0], wp1[1], leg, b2);
  return [start, wp1, wp2, start];
}

async function ensureOrigin() {
  if (origin) return true;
  if (locationInput.value.trim()) {
    await searchLocation();
    return !!origin;
  }
  useCurrentLocation();
  return false;
}

async function generate() {
  summaryEl.textContent = "";
  if (!origin) {
    const ok = await ensureOrigin();
    if (!ok) return;
  }

  generateBtn.disabled = true;
  setStatus("Finding a random loop\u2026");

  const minutes = parseInt(durationEl.value, 10) || 30;
  const speedMps = (WALK_PACE_KMH * 1000) / 3600;
  const targetSeconds = minutes * 60;
  const targetDistance = speedMps * targetSeconds;

  let best = null;
  let bestDiff = Infinity;
  let scale = 1;
  const attempts = 6;

  for (let i = 0; i < attempts; i++) {
    const candidate = buildLoopCandidate(origin, targetDistance * scale);
    try {
      const route = await fetchRoute(candidate);
      const diff = Math.abs(route.duration - targetSeconds);
      if (diff < bestDiff) { bestDiff = diff; best = route; }
      if (bestDiff / targetSeconds < 0.12) break;
      scale *= targetSeconds / route.duration;
      scale = Math.max(0.5, Math.min(1.8, scale));
    } catch (_) { /* try again */ }
  }

  if (!best) {
    setStatus("Couldn't build a route here. Try again.");
    generateBtn.disabled = false;
    return;
  }

  if (routeLayer) routeLayer.remove();
  routeLayer = L.geoJSON(best.geometry, {
    style: { color: "#d9582b", weight: 5, opacity: 0.9 },
  }).addTo(map);
  map.fitBounds(routeLayer.getBounds(), { padding: [40, 40] });

  const mins = Math.round(best.duration / 60);
  const km = (best.distance / 1000).toFixed(2);
  setStatus("");
  summaryEl.textContent = `\u2248 ${mins} min \u00b7 ${km} km`;

  if (window.matchMedia("(max-width: 520px)").matches) {
    document.body.classList.add("panel-collapsed");
    setTimeout(() => map.invalidateSize(), 320);
  }
  generateBtn.disabled = false;
}
