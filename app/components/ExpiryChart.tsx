"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import type { TooltipProps } from "recharts";
import type { OptionPoint } from "@/types/options";

const currency = (value: number | null | undefined) => {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "-";
  }
  return `$${value.toFixed(2)}`;
};

function CustomTooltip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  const datum = payload[0].payload as OptionPoint;
  const lines = [
    `Strike: ${currency(datum.strike)}`,
    `Premium: ${currency(datum.premium)}`,
    `Intrinsic: ${currency(datum.intrinsic)}`,
    `Extrinsic: ${currency(datum.extrinsic)}`,
    `Break-even: ${currency(datum.breakEven)}`,
    `2× target: ${currency(datum.target2x)}`,
    `3× target: ${currency(datum.target3x)}`
  ];

  return (
    <div
      style={{
        background: "#0f1725",
        border: "1px solid #253047",
        borderRadius: 8,
        padding: "8px 12px",
        fontSize: 12,
        whiteSpace: "pre",
        lineHeight: 1.5
      }}
    >
      {lines.join("\n")}
    </div>
  );
}

export default function ExpiryChart({
  data,
  underlyingPrice,
  expiration
}: {
  data: OptionPoint[];
  underlyingPrice: number | null;
  expiration: string;
}) {
  const sorted = useMemo(() => [...data].sort((a, b) => a.strike - b.strike), [data]);
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const minStrike = sorted.at(0)?.strike;
    const maxStrike = sorted.at(-1)?.strike;
    console.log(
      `[ExpiryChart] ${expiration} rendering ${sorted.length} points (strike range: ${minStrike} – ${maxStrike})`
    );
  }, [expiration, sorted]);

  useEffect(() => {
    if (size.width > 0) {
      console.log(
        `[ExpiryChart] ${expiration} container measured at ${size.width.toFixed(0)}×${Math.max(size.height, 320).toFixed(0)}px`
      );
    }
  }, [expiration, size.height, size.width]);

  useEffect(() => {
    if (!containerEl) {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }
      const { width, height } = entry.contentRect;
      setSize({ width, height });
    });

    observer.observe(containerEl);
    const { width, height } = containerEl.getBoundingClientRect();
    setSize({ width, height });

    return () => {
      observer.disconnect();
    };
  }, [containerEl]);

  const containerRef = useCallback((node: HTMLDivElement | null) => {
    setContainerEl(node);
  }, []);

  return (
    <div
      style={{
        background: "#0a1222",
        border: "1px solid #1b2335",
        borderRadius: 16,
        padding: 20,
        display: "flex",
        flexDirection: "column",
        gap: 12
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: 14,
          color: "#c5cee3"
        }}
      >
        <span>Expiry: {expiration}</span>
        {underlyingPrice !== null && <span>Spot: {currency(underlyingPrice)}</span>}
      </div>
      {sorted.length === 0 ? (
        <div style={{ color: "#7e8ca5", fontSize: 14 }}>No options available.</div>
      ) : (
        <div ref={containerRef} style={{ width: "100%", height: 360, minHeight: 320 }}>
          {size.width <= 0 ? (
            <div style={{ color: "#7e8ca5", fontSize: 14 }}>Measuring chart area...</div>
          ) : (
            <ComposedChart
              width={size.width}
              height={Math.max(size.height, 320)}
              data={sorted}
              margin={{ left: 0, right: 20, top: 10, bottom: 10 }}
            >
              <CartesianGrid stroke="#1f2b3a" strokeDasharray="3 3" />
              <XAxis
                dataKey="strike"
                type="number"
                domain={["dataMin", "dataMax"]}
                stroke="#b7c4dd"
                tickFormatter={(value) => `$${value}`}
                label={{ value: "Strike", position: "insideBottom", offset: -5, fill: "#b7c4dd" }}
              />
              <YAxis
                yAxisId="left"
                stroke="#b7c4dd"
                tickFormatter={(value) => `$${value}`}
                label={{ value: "Option $/share", angle: -90, position: "insideLeft", fill: "#b7c4dd" }}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                stroke="#b7c4dd"
                tickFormatter={(value) => `$${value}`}
                label={{ value: "Underlying $", angle: 90, position: "insideRight", fill: "#b7c4dd" }}
              />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(255,255,255,0.05)" }} />
              <Legend />
              <Bar
                yAxisId="left"
                dataKey="intrinsic"
                stackId="value"
                name="Intrinsic"
                fill="#5ec2a2"
              />
              <Bar
                yAxisId="left"
                dataKey="extrinsic"
                stackId="value"
                name="Extrinsic"
                fill="#5b8ef0"
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="breakEven"
                stroke="#f0c36d"
                name="Break-even"
                dot={{ strokeWidth: 2 }}
                activeDot={{ r: 5 }}
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="target2x"
                stroke="#f88379"
                name="2× target"
                dot={false}
                activeDot={{ r: 5 }}
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="target3x"
                stroke="#c084fc"
                name="3× target"
                dot={false}
                activeDot={{ r: 5 }}
              />
              {typeof underlyingPrice === "number" && Number.isFinite(underlyingPrice) && (
                <ReferenceLine
                  x={underlyingPrice}
                  xAxisId={0}
                  yAxisId="left"
                  stroke="#ffffff"
                  strokeDasharray="4 4"
                  label={{
                    value: `Spot ${currency(underlyingPrice)}`,
                    fill: "#ffffff",
                    position: "top",
                    angle: 0
                  }}
                />
              )}
            </ComposedChart>
          )}
        </div>
      )}
      <p style={{ color: "#7e8ca5", fontSize: 12, margin: 0 }}>
        Bars = option value now (intrinsic + extrinsic). Lines = underlying price levels at expiry (break-even, 2×, 3×).
      </p>
    </div>
  );
}
