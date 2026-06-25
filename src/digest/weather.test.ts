import { describe, expect, it } from "vitest";
import { describeWmo, fetchWeatherLine } from "./weather.js";

describe("describeWmo", () => {
  it("maps known WMO codes to Japanese", () => {
    expect(describeWmo(0)).toBe("快晴");
    expect(describeWmo(63)).toBe("雨");
    expect(describeWmo(95)).toBe("雷雨");
  });
  it("falls back for unknown codes", () => {
    expect(describeWmo(999)).toBe("—");
  });
});

describe("fetchWeatherLine", () => {
  const loc = { lat: 35.69, lon: 139.69, label: "東京" };

  it("formats a one-line forecast (label, condition, temps, precip)", async () => {
    const fetchImpl = async () => ({
      ok: true,
      json: async () => ({
        daily: {
          weather_code: [63],
          temperature_2m_max: [21.1],
          temperature_2m_min: [19.6],
          precipitation_probability_max: [100],
        },
      }),
    });
    expect(await fetchWeatherLine(loc, { fetchImpl })).toBe("東京: 雨 最高21℃ / 最低20℃ 降水100%");
  });

  it("returns null on a non-ok response (best-effort)", async () => {
    expect(
      await fetchWeatherLine(loc, {
        fetchImpl: async () => ({ ok: false, json: async () => ({}) }),
      }),
    ).toBeNull();
  });

  it("returns null when the request throws (never breaks the digest)", async () => {
    const fetchImpl = async () => {
      throw new Error("network down");
    };
    expect(await fetchWeatherLine(loc, { fetchImpl })).toBeNull();
  });
});
