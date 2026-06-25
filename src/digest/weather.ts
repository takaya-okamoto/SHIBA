/**
 * Today's weather for the morning digest via Open-Meteo (free, no API key, fixed host). Coordinates
 * are configured once (WEATHER_LAT/LON/LABEL) so there is no runtime geocoding. Best-effort: returns
 * null on any failure so the digest still sends without weather.
 */
export interface WeatherLocation {
  lat: number;
  lon: number;
  label: string; // display name, e.g. "東京"
}

/** WMO weather-code -> short Japanese. Unknown codes fall back to "—". */
const WMO: Record<number, string> = {
  0: "快晴",
  1: "晴れ",
  2: "晴れ時々曇り",
  3: "曇り",
  45: "霧",
  48: "霧",
  51: "霧雨",
  53: "霧雨",
  55: "霧雨",
  56: "着氷性の霧雨",
  57: "着氷性の霧雨",
  61: "小雨",
  63: "雨",
  65: "大雨",
  66: "着氷性の雨",
  67: "着氷性の雨",
  71: "小雪",
  73: "雪",
  75: "大雪",
  77: "霧雪",
  80: "にわか雨",
  81: "にわか雨",
  82: "激しいにわか雨",
  85: "にわか雪",
  86: "にわか雪",
  95: "雷雨",
  96: "雹を伴う雷雨",
  99: "雹を伴う雷雨",
};

export function describeWmo(code: number): string {
  return WMO[code] ?? "—";
}

type FetchLike = (url: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

interface ForecastResponse {
  daily?: {
    weather_code?: number[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    precipitation_probability_max?: (number | null)[];
  };
}

/** Build a one-line JA weather string (incl. label), or null on any error. */
export async function fetchWeatherLine(
  loc: WeatherLocation,
  opts: { tz?: string; fetchImpl?: FetchLike } = {},
): Promise<string | null> {
  const tz = opts.tz ?? "Asia/Tokyo";
  const f = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const daily = "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max";
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&daily=${daily}&timezone=${encodeURIComponent(tz)}&forecast_days=1`;
  try {
    const res = await f(url);
    if (!res.ok) return null;
    const d = ((await res.json()) as ForecastResponse).daily;
    if (!d?.weather_code?.length) return null;
    const code = d.weather_code[0] ?? -1;
    const hi = d.temperature_2m_max?.[0];
    const lo = d.temperature_2m_min?.[0];
    const pop = d.precipitation_probability_max?.[0];
    const temp = hi != null && lo != null ? ` 最高${Math.round(hi)}℃ / 最低${Math.round(lo)}℃` : "";
    const rain = pop != null ? ` 降水${pop}%` : "";
    return `${loc.label}: ${describeWmo(code)}${temp}${rain}`;
  } catch {
    return null;
  }
}
