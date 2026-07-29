/**
 * Device location + lightweight place/weather helpers.
 * Weather: Open-Meteo (no API key). Place label: BigDataCloud reverse geocode.
 * Nearby: Photon (Komoot). Travel time: Nominatim + OSRM public demos.
 */
import { getPrefs, patchPrefs } from "../stores/settingsStore";

export type LocationPermission = "unknown" | "granted" | "denied";

export interface DeviceCoords {
  latitude: number;
  longitude: number;
  accuracy?: number;
  label?: string;
  updatedAt: number;
}

export interface WeatherSnapshot {
  temperature: number;
  feelsLike: number;
  humidity: number;
  windSpeed: number;
  weatherCode: number;
  condition: string;
  unit: "celsius" | "fahrenheit";
  placeLabel: string;
}

export interface NearbyPlace {
  name: string;
  category: string;
  distanceKm: number;
  latitude: number;
  longitude: number;
}

export interface TravelEstimate {
  destination: string;
  destinationLabel: string;
  durationMinutes: number;
  distanceKm: number;
  placeLabel: string;
}

const CACHE_KEY = "arcsonare.location.v1";
const CACHE_TTL_MS = 15 * 60 * 1000;

function readCache(): DeviceCoords | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DeviceCoords;
    if (
      typeof parsed.latitude !== "number" ||
      typeof parsed.longitude !== "number" ||
      typeof parsed.updatedAt !== "number"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(coords: DeviceCoords): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(coords));
  } catch {
    /* ignore quota */
  }
}

export function clearLocationCache(): void {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    /* ignore */
  }
}

export function getStoredLocationPermission(): LocationPermission {
  const value = getPrefs().general.locationPermission;
  if (value === "granted" || value === "denied") return value;
  return "unknown";
}

export function markLocationPrompted(): void {
  patchPrefs("general", { locationPrompted: true });
}

export function setLocationPermission(permission: LocationPermission): void {
  patchPrefs("general", {
    locationPermission: permission,
    locationPrompted: true,
  });
  if (permission !== "granted") clearLocationCache();
}

function preferFahrenheit(): boolean {
  const lang = (navigator.language || "en-US").toLowerCase();
  return lang === "en-us" || lang.endsWith("-us") || lang === "en-lr" || lang === "en-mm";
}

/** WMO weather interpretation codes (Open-Meteo). */
export function describeWeatherCode(code: number): string {
  if (code === 0) return "clear";
  if (code === 1) return "mainly clear";
  if (code === 2) return "partly cloudy";
  if (code === 3) return "overcast";
  if (code === 45 || code === 48) return "foggy";
  if (code >= 51 && code <= 57) return "drizzling";
  if (code >= 61 && code <= 67) return "raining";
  if (code >= 71 && code <= 77) return "snowing";
  if (code >= 80 && code <= 82) return "showers";
  if (code >= 85 && code <= 86) return "snow showers";
  if (code >= 95 && code <= 99) return "thunderstorms";
  return "mixed conditions";
}

function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function geolocationErrorMessage(err: GeolocationPositionError): string {
  if (err.code === err.PERMISSION_DENIED) {
    return "Location access is turned off. Allow it in Windows or ArcSonare settings so I can check weather and places near you.";
  }
  if (err.code === err.POSITION_UNAVAILABLE) {
    return "I couldn't get a GPS fix right now. Try again in a moment.";
  }
  return "Getting your location timed out. Try again.";
}

export async function requestDeviceLocation(options?: {
  force?: boolean;
}): Promise<DeviceCoords> {
  if (!options?.force) {
    const cached = readCache();
    if (cached && Date.now() - cached.updatedAt < CACHE_TTL_MS) {
      return cached;
    }
  }

  if (!("geolocation" in navigator)) {
    throw new Error("This device does not support location services.");
  }

  const position = await new Promise<GeolocationPosition>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: false,
      timeout: 12_000,
      maximumAge: options?.force ? 0 : 60_000,
    });
  }).catch((err: GeolocationPositionError) => {
    setLocationPermission("denied");
    throw new Error(geolocationErrorMessage(err));
  });

  setLocationPermission("granted");

  let label: string | undefined;
  try {
    label = await reverseGeocode(
      position.coords.latitude,
      position.coords.longitude,
    );
  } catch {
    /* optional */
  }

  const coords: DeviceCoords = {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracy: position.coords.accuracy,
    label,
    updatedAt: Date.now(),
  };
  writeCache(coords);
  return coords;
}

export async function reverseGeocode(
  latitude: number,
  longitude: number,
): Promise<string> {
  const url =
    `https://api.bigdatacloud.net/data/reverse-geocode-client` +
    `?latitude=${encodeURIComponent(String(latitude))}` +
    `&longitude=${encodeURIComponent(String(longitude))}` +
    `&localityLanguage=en`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Could not resolve place name.");
  const data = (await res.json()) as {
    city?: string;
    locality?: string;
    principalSubdivision?: string;
    countryName?: string;
  };
  const city = data.city || data.locality;
  const region = data.principalSubdivision;
  if (city && region) return `${city}, ${region}`;
  if (city) return city;
  if (region && data.countryName) return `${region}, ${data.countryName}`;
  return data.countryName || "your area";
}

export async function fetchWeatherForCurrentLocation(): Promise<WeatherSnapshot> {
  const coords = await requestDeviceLocation();
  const unit = preferFahrenheit() ? "fahrenheit" : "celsius";
  const tempUnit = unit === "fahrenheit" ? "fahrenheit" : "celsius";
  const windUnit = unit === "fahrenheit" ? "mph" : "kmh";
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${coords.latitude}&longitude=${coords.longitude}` +
    `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m` +
    `&temperature_unit=${tempUnit}&wind_speed_unit=${windUnit}&timezone=auto`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Weather service is unavailable right now.");
  const data = (await res.json()) as {
    current?: {
      temperature_2m?: number;
      apparent_temperature?: number;
      relative_humidity_2m?: number;
      weather_code?: number;
      wind_speed_10m?: number;
    };
  };
  const current = data.current;
  if (!current || typeof current.temperature_2m !== "number") {
    throw new Error("Weather data came back incomplete.");
  }
  const weatherCode = Number(current.weather_code ?? 0);
  const placeLabel =
    coords.label ||
    (await reverseGeocode(coords.latitude, coords.longitude).catch(
      () => "your area",
    ));
  if (!coords.label && placeLabel) {
    writeCache({ ...coords, label: placeLabel });
  }
  return {
    temperature: Math.round(current.temperature_2m),
    feelsLike: Math.round(Number(current.apparent_temperature ?? current.temperature_2m)),
    humidity: Math.round(Number(current.relative_humidity_2m ?? 0)),
    windSpeed: Math.round(Number(current.wind_speed_10m ?? 0)),
    weatherCode,
    condition: describeWeatherCode(weatherCode),
    unit,
    placeLabel,
  };
}

export async function fetchNearbyPlaces(query = "cafe"): Promise<{
  places: NearbyPlace[];
  placeLabel: string;
}> {
  const coords = await requestDeviceLocation();
  const q = query.trim() || "cafe";
  const url =
    `https://photon.komoot.io/api/` +
    `?q=${encodeURIComponent(q)}` +
    `&lat=${coords.latitude}&lon=${coords.longitude}` +
    `&limit=6&lang=en`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Nearby places lookup failed.");
  const data = (await res.json()) as {
    features?: Array<{
      geometry?: { coordinates?: [number, number] };
      properties?: {
        name?: string;
        type?: string;
        osm_value?: string;
        city?: string;
        street?: string;
      };
    }>;
  };
  const places: NearbyPlace[] = (data.features ?? [])
    .map((f) => {
      const [lon, lat] = f.geometry?.coordinates ?? [NaN, NaN];
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      const name =
        f.properties?.name ||
        f.properties?.street ||
        f.properties?.osm_value ||
        "Place";
      return {
        name,
        category: f.properties?.osm_value || f.properties?.type || q,
        distanceKm: haversineKm(coords.latitude, coords.longitude, lat, lon),
        latitude: lat,
        longitude: lon,
      } satisfies NearbyPlace;
    })
    .filter((p): p is NearbyPlace => p !== null)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, 5);

  const placeLabel =
    coords.label ||
    (await reverseGeocode(coords.latitude, coords.longitude).catch(
      () => "your area",
    ));
  return { places, placeLabel };
}

async function geocodeNear(
  query: string,
  near: DeviceCoords,
): Promise<{ latitude: number; longitude: number; label: string } | null> {
  const url =
    `https://nominatim.openstreetmap.org/search` +
    `?q=${encodeURIComponent(query)}` +
    `&format=json&limit=5&addressdetails=0` +
    `&viewbox=${near.longitude - 0.6},${near.latitude + 0.6},${near.longitude + 0.6},${near.latitude - 0.6}` +
    `&bounded=0`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) return null;
  const rows = (await res.json()) as Array<{
    lat?: string;
    lon?: string;
    display_name?: string;
  }>;
  if (!rows.length) return null;
  // Prefer the closest hit to the user.
  let best: { latitude: number; longitude: number; label: string; d: number } | null =
    null;
  for (const row of rows) {
    const latitude = Number(row.lat);
    const longitude = Number(row.lon);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
    const d = haversineKm(near.latitude, near.longitude, latitude, longitude);
    if (!best || d < best.d) {
      best = {
        latitude,
        longitude,
        label: row.display_name || query,
        d,
      };
    }
  }
  return best
    ? {
        latitude: best.latitude,
        longitude: best.longitude,
        label: best.label,
      }
    : null;
}

export async function fetchTravelTimeTo(
  destination: string,
): Promise<TravelEstimate> {
  const destQuery = destination.trim();
  if (!destQuery) throw new Error("Tell me where you want to go.");
  const from = await requestDeviceLocation();
  const dest = await geocodeNear(destQuery, from);
  if (!dest) {
    throw new Error(`I couldn't find "${destQuery}" near you.`);
  }
  const url =
    `https://router.project-osrm.org/route/v1/driving/` +
    `${from.longitude},${from.latitude};${dest.longitude},${dest.latitude}` +
    `?overview=false`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Travel-time service is unavailable right now.");
  const data = (await res.json()) as {
    routes?: Array<{ duration?: number; distance?: number }>;
  };
  const route = data.routes?.[0];
  if (!route || typeof route.duration !== "number") {
    throw new Error("No driving route found to that place.");
  }
  const placeLabel =
    from.label ||
    (await reverseGeocode(from.latitude, from.longitude).catch(
      () => "your area",
    ));
  return {
    destination: destQuery,
    destinationLabel: dest.label,
    durationMinutes: Math.max(1, Math.round(route.duration / 60)),
    distanceKm: Math.round(((route.distance ?? 0) / 1000) * 10) / 10,
    placeLabel,
  };
}
