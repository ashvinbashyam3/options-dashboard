"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ExpiryChart from "./components/ExpiryChart";
import type { OptionPoint, OptionsApiResponse } from "@/types/options";

const defaultTicker = "AAPL";

type FetchState = {
  data: OptionsApiResponse | null;
  loading: boolean;
  error: string | null;
};

export default function HomePage() {
  const [tickerInput, setTickerInput] = useState(defaultTicker);
  const [{ data, loading, error }, setState] = useState<FetchState>({
    data: null,
    loading: false,
    error: null
  });

  const fetchChain = useCallback(async (ticker: string) => {
    const normalized = ticker.trim().toUpperCase();
    if (!normalized) {
      setState((prev) => ({ ...prev, error: "Please enter a ticker." }));
      return;
    }
    console.log("[OptionsUI] Fetching chain for", normalized);
    setState({ data: null, loading: true, error: null });
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
      setState({ data: null, loading: false, error: err instanceof Error ? err.message : "Unknown error" });
    }
  }, []);

  useEffect(() => {
    fetchChain(defaultTicker);
  }, [fetchChain]);

  const grouped = useMemo(() => {
    if (!data) {
      return [] as { expiration: string; points: OptionPoint[] }[];
    }
    const map = new Map<string, OptionPoint[]>();
    data.options.forEach((option) => {
      if (!map.has(option.expiration)) {
        map.set(option.expiration, []);
      }
      map.get(option.expiration)!.push(option);
    });
    return data.expirations
      .filter((expiry) => map.has(expiry))
      .map((expiry) => ({ expiration: expiry, points: map.get(expiry)! }));
  }, [data]);

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
        color: "#f5f7ff"
      }}
    >
      <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", flexDirection: "column", gap: 24 }}>
        <header style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <h1 style={{ margin: 0, fontSize: 32 }}>Options Payoff Map (Next 10 Expiries)</h1>
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
                minWidth: 160
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
                cursor: "pointer"
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
                fontSize: 14
              }}
            >
              {error}
            </div>
          )}
        </header>

        {data && (
          <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ color: "#c5cee3", fontSize: 14 }}>
              Symbol: <strong>{tickerInput.trim().toUpperCase()}</strong> · Spot: {" "}
              {data.underlyingPrice !== null ? `$${data.underlyingPrice.toFixed(2)}` : "Unavailable"}
              . Snapshot courtesy of Massive.
            </div>
          </section>
        )}

        <section
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))",
            gap: 20
          }}
        >
          {loading && !data && <div>Loading option chain...</div>}
          {!loading && data && data.expirations.length === 0 && (
            <div style={{ color: "#9ba5c4" }}>No expiries found for this symbol.</div>
          )}
          {!loading && data &&
            grouped.map(({ expiration, points }) => (
              <ExpiryChart
                key={expiration}
                expiration={expiration}
                data={points}
                underlyingPrice={data.underlyingPrice}
              />
            ))}
        </section>
      </div>
    </main>
  );
}
