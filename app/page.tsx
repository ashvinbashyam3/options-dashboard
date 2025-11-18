"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Slider from "rc-slider";
import "rc-slider/assets/index.css";
import ExpiryChart from "./components/ExpiryChart";
import type { OptionPoint, OptionsApiResponse } from "@/types/options";

const defaultTicker = "AAPL";

type FetchState = {
  data: OptionsApiResponse | null;
  loading: boolean;
  error: string | null;
};

const roundToNearest = (value: number, nearest: number) => {
  return Math.round(value / nearest) * nearest;
};

export default function HomePage() {
  const [tickerInput, setTickerInput] = useState(defaultTicker);
  const [{ data, loading, error }, setState] = useState<FetchState>({
    data: null,
    loading: false,
    error: null,
  });
  const [strikeRange, setStrikeRange] = useState<[number, number] | null>(null);

  const fullStrikeRange = useMemo((): [number, number] | null => {
    if (!data?.options || data.options.length === 0) {
      return null;
    }
    const strikes = data.options.map((o) => o.strike);
    return [Math.min(...strikes), Math.max(...strikes)];
  }, [data]);

  useEffect(() => {
    if (data && fullStrikeRange) {
      const spot = data.underlyingSpot;
      const defaultMin = roundToNearest(spot * 0.8, 5);
      const defaultMax = roundToNearest(spot * 1.3, 5);
      setStrikeRange([
        Math.max(defaultMin, fullStrikeRange[0]),
        Math.min(defaultMax, fullStrikeRange[1]),
      ]);
    } else {
      setStrikeRange(null);
    }
  }, [data, fullStrikeRange]);

  const fetchChain = useCallback(async (ticker: string) => {
    const normalized = ticker.trim().toUpperCase();
    if (!normalized) {
      setState((prev) => ({ ...prev, error: "Please enter a ticker." }));
      return;
    }
    console.log("[OptionsUI] Fetching chain for", normalized);
    setState({ data: null, loading: true, error: null });
    setStrikeRange(null); // Reset slider on new fetch
    try {
      const response = await fetch(`/api/options?ticker=${encodeURIComponent(normalized)}`);
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        const messageParts = [payload?.message || "Failed to load options."];
        if (payload?.statusCode) {
          messageParts.push(`(HTTP ${payload.statusCode})`);
        }
        if (payload?.details) {
          messageParts.push(String(payload.details));
        }
        console.error("[OptionsUI] API error", messageParts.join(" "));
        throw new Error(messageParts.join(" "));
      }
      const payload = (await response.json()) as OptionsApiResponse;
      console.log(
        `[OptionsUI] Loaded ${payload.options.length} options across ${payload.expirations.length} expirations`
      );
      setState({ data: payload, loading: false, error: null });
    } catch (err) {
      console.error("[OptionsUI] Failed to load chain", err);
      setState({
        data: null,
        loading: false,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }, []);

  useEffect(() => {
    fetchChain(defaultTicker);
  }, [fetchChain]);

  const grouped = useMemo(() => {
    if (!data || !strikeRange) {
      return [] as { expiration: string; points: OptionPoint[] }[];
    }
    const [minStrike, maxStrike] = strikeRange;
    const map = new Map<string, OptionPoint[]>();
    data.options.forEach((option) => {
      if (option.strike >= minStrike && option.strike <= maxStrike) {
        if (!map.has(option.expiration)) {
          map.set(option.expiration, []);
        }
        map.get(option.expiration)!.push(option);
      }
    });
    return data.expirations
      .filter((expiry) => map.has(expiry))
      .map((expiry) => ({ expiration: expiry, points: map.get(expiry)! }));
  }, [data, strikeRange]);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    fetchChain(tickerInput);
  };

  return (
    <main
      style={{
        minHeight: "100vh",
        padding: "32px clamp(16px, 4vw, 48px)",
        background: "#050b17",
        color: "#f5f7ff",
      }}
    >
      <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", flexDirection: "column", gap: 24 }}>
        <header style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <h1 style={{ margin: 0, fontSize: 32 }}>Options Payoff Map (Next 20 Expiries)</h1>
          <p style={{ margin: 0, color: "#9ba5c4", maxWidth: 780 }}>
            Visualize call pricing, intrinsic vs extrinsic value, break-even levels, and 2×/3× underlying targets.
            Data sourced from Massive snapshot API.
          </p>
          <form
            onSubmit={handleSubmit}
            style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}
          >
            <input
              value={tickerInput}
              onChange={(e) => setTickerInput(e.target.value.toUpperCase())}
              placeholder="AAPL"
              style={{
                padding: "10px 14px",
                borderRadius: 10,
                border: "1px solid #273147",
                background: "#0a1222",
                color: "#f5f7ff",
                minWidth: 160,
              }}
            />
            <button
              type="submit"
              style={{
                padding: "10px 18px",
                borderRadius: 10,
                border: "none",
                background: "linear-gradient(120deg, #5b8ef0, #c084fc)",
                color: "#fff",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {loading ? "Loading..." : "Load chain"}
            </button>
          </form>
          {error && (
            <div
              style={{
                background: "#351a1f",
                border: "1px solid #f07178",
                color: "#ffb4c1",
                padding: "10px 14px",
                borderRadius: 10,
                fontSize: 14,
              }}
            >
              {error}
            </div>
          )}
        </header>

        {data && (
          <section style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ color: "#c5cee3", fontSize: 14 }}>
              Symbol: <strong>{tickerInput.trim().toUpperCase()}</strong> · Spot:{" "}
              {data.underlyingSpot !== null ? `${data.underlyingSpot.toFixed(2)}` : "Unavailable"}
              . Snapshot courtesy of Massive.
            </div>
            {fullStrikeRange && strikeRange && (
              <div style={{ maxWidth: 600 }}>
                <label style={{ display: "block", marginBottom: 8, fontSize: 14, color: "#c5cee3" }}>
                  Strike Price Range: ${strikeRange[0]} – ${strikeRange[1]}
                </label>
                <Slider
                  range
                  min={fullStrikeRange[0]}
                  max={fullStrikeRange[1]}
                  value={strikeRange}
                  onChange={(value) => setStrikeRange(value as [number, number])}
                  step={5}
                  styles={{
                    track: { backgroundColor: "#5b8ef0" },
                    handle: { borderColor: "#5b8ef0", backgroundColor: "#fff" },
                  }}
                />
              </div>
            )}
          </section>
        )}

        <section
          style={{
            display: "grid",
            // Two columns, each taking up one fraction of the available space.
            gridTemplateColumns: "repeat(2, 1fr)",
            gap: 20,
          }}
        >
          {loading && !data && <div>Loading option chain...</div>}
          {!loading && data && data.expirations.length === 0 && (
            <div style={{ color: "#9ba5c4" }}>No expiries found for this symbol.</div>
          )}
          {!loading &&
            data &&
            grouped.map(({ expiration, points }) => (
              <ExpiryChart
                key={expiration}
                expiration={expiration}
                data={points}
                underlyingSpot={data.underlyingSpot}
              />
            ))}
        </section>
      </div>
    </main>
  );
}

