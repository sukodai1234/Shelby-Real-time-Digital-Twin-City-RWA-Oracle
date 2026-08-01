export const LOCATION_CACHE_TTL_MS = 30 * 60 * 1000;

export const LOW_POWER_LOCATION_OPTIONS: PositionOptions = {
  enableHighAccuracy: false,
  timeout: 10_000,
  maximumAge: LOCATION_CACHE_TTL_MS,
};

export const JOURNEY_LOCATION_OPTIONS: PositionOptions = {
  enableHighAccuracy: false,
  timeout: 12_000,
  maximumAge: 5 * 60 * 1000,
};

const DEVICE_LOCATION_KEY = "shelby_device_location_v1";

export type CachedDeviceLocation = {
  name: string;
  country: string;
  lat: number;
  lon: number;
  region: string;
  savedAt: number;
};

export function readCachedDeviceLocation() {
  try {
    const raw = window.localStorage.getItem(DEVICE_LOCATION_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as CachedDeviceLocation;
    const validCoordinates = Number.isFinite(cached.lat) && Number.isFinite(cached.lon);
    if (!validCoordinates || Date.now() - cached.savedAt > LOCATION_CACHE_TTL_MS) return null;
    return cached;
  } catch {
    return null;
  }
}

export function saveCachedDeviceLocation(location: Omit<CachedDeviceLocation, "savedAt">) {
  try {
    window.localStorage.setItem(DEVICE_LOCATION_KEY, JSON.stringify({ ...location, savedAt: Date.now() }));
  } catch {
    // Location still works when storage is unavailable or private browsing blocks it.
  }
}
