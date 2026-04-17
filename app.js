const OSRM_BASE = "https://router.project-osrm.org/route/v1/foot";
const EARTH_RADIUS_M = 6371000;

const map = L.map("map").setView([20, 0], 2);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 19,
}).addTo(map);

let startMarker = null;
let routeLayer = null;

const statusEl = document.getElementById("status");
const summaryEl = document.getElementById("summary");
const button = document.getElementById("generate");

button.addEventListener("click", generate);

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

async function fetchRoute(points) {
  const coords = points.map(([lat, lon]) => `${lon},${lat}`).join(";");
  const url = `${OSRM_BASE}/${coords}?overview=full&geometries=geojson&steps=false`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Routing request failed: ${res.status}`);
  const data = await res.json();
  if (!data.routes || !data.routes.length) throw new Error("No route found.");
  return data.routes[0];
}

function buildLoopCandidate(origin, targetDistanceM) {
  const legFraction = 0.28 + Math.random() * 0.08;
  const leg = targetDistanceM * legFraction;
  const b1 = Math.random() * 360;
  const turn = 80 + Math.random() * 80;
  const sign = Math.random() < 0.5 ? 1 : -1;
  const b2 = b1 + sign * turn;
  const wp1 = offsetPoint(origin[0], origin[1], leg, b1);
  const wp2 = offsetPoint(wp1[0], wp1[1], leg, b2);
  return [origin, wp1, wp2, origin];
}

async function generate() {
  button.disabled = true;
  summaryEl.textContent = "";
  statusEl.textContent = "Getting your location\u2026";

  const minutes = Math.max(5, Math.min(240, parseInt(document.getElementById("minutes").value, 10) || 30));
  const paceKmh = Math.max(2, Math.min(8, parseFloat(document.getElementById("pace").value) || 5));
  const speedMps = (paceKmh * 1000) / 3600;
  const targetSeconds = minutes * 60;
  const targetDistance = speedMps * targetSeconds;

  let origin;
  try {
    origin = await getLocation();
  } catch (e) {
    statusEl.textContent = e.message;
    button.disabled = false;
    return;
  }

  if (startMarker) startMarker.remove();
  startMarker = L.marker(origin).addTo(map).bindPopup("Start / End");
  map.setView(origin, 15);

  statusEl.textContent = "Finding a random loop\u2026";

  const attempts = 6;
  let best = null;
  let bestDiff = Infinity;
  let scale = 1;

  for (let i = 0; i < attempts; i++) {
    const candidate = buildLoopCandidate(origin, targetDistance * scale);
    try {
      const route = await fetchRoute(candidate);
      const diff = Math.abs(route.duration - targetSeconds);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = route;
      }
      if (bestDiff / targetSeconds < 0.12) break;
      scale *= targetSeconds / route.duration;
      scale = Math.max(0.5, Math.min(1.8, scale));
    } catch (_) {
      // try another
    }
  }

  if (!best) {
    statusEl.textContent = "Couldn't build a route here. Try again.";
    button.disabled = false;
    return;
  }

  if (routeLayer) routeLayer.remove();
  routeLayer = L.geoJSON(best.geometry, {
    style: { color: "#e63946", weight: 5, opacity: 0.9 },
  }).addTo(map);
  map.fitBounds(routeLayer.getBounds(), { padding: [40, 40] });

  const mins = Math.round(best.duration / 60);
  const km = (best.distance / 1000).toFixed(2);
  statusEl.textContent = "";
  summaryEl.textContent = `\u2248 ${mins} min \u00b7 ${km} km`;
  button.disabled = false;
}
