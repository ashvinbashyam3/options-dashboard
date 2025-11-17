import { NextRequest, NextResponse } from "next/server";
import type { OptionPoint, OptionsApiResponse } from "@/types/options";

type MassiveOptionRow = {
  details?: {
    contract_type?: string;
    expiration_date?: string;
    strike_price?: number | string;
    ticker?: string;
  };
  break_even_price?: number | string;
  last_quote?: {
    bid?: number | string;
    ask?: number | string;
  };
  last_trade?: {
    price?: number | string;
  };
  underlying_asset?: {
    last_trade?: { price?: number | string };
    day?: { close?: number | string };
    last_quote?: { bid?: number | string; ask?: number | string };
  };
};

type MassiveResponse = {
  results?: MassiveOptionRow[];
  next_url?: string | null;
};

const MAX_PAGES = 15;
const MASSIVE_BASE = "https://api.massive.com/v3/snapshot/options/";

const parseNumber = (value: unknown): number | null => {
  if (value === null || value === undefined) {
    return null;
  }
  const num = typeof value === "string" ? Number(value) : (value as number);
  if (!Number.isFinite(num)) {
    return null;
  }
  return num;
};

const pickUnderlyingPrice = (row: MassiveOptionRow): number | null => {
  const priceFromTrade = parseNumber(row.underlying_asset?.last_trade?.price);
  if (priceFromTrade !== null) {
    return priceFromTrade;
  }
  const priceFromClose = parseNumber(row.underlying_asset?.day?.close);
  if (priceFromClose !== null) {
    return priceFromClose;
  }
  const priceFromBid = parseNumber(row.underlying_asset?.last_quote?.bid);
  if (priceFromBid !== null) {
    return priceFromBid;
  }
  const priceFromAsk = parseNumber(row.underlying_asset?.last_quote?.ask);
  return priceFromAsk;
};

const ensureApiKey = (url: URL, apiKey: string) => {
  if (!url.searchParams.has("apiKey")) {
    url.searchParams.append("apiKey", apiKey);
  }
};

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const rawTicker = searchParams.get("ticker");
  if (!rawTicker) {
    return NextResponse.json({ message: "Missing ticker parameter" }, { status: 400 });
  }
  const ticker = rawTicker.trim().toUpperCase();
  if (!ticker) {
    return NextResponse.json({ message: "Ticker cannot be empty" }, { status: 400 });
  }

  const apiKey = process.env.MASSIVE_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ message: "MASSIVE_API_KEY is not configured" }, { status: 500 });
  }

  let nextUrl: URL | null = new URL(`${MASSIVE_BASE}${encodeURIComponent(ticker)}`);
  nextUrl.searchParams.set("limit", "250");
  nextUrl.searchParams.set("contract_type", "call");
  ensureApiKey(nextUrl, apiKey);

  const rows: MassiveOptionRow[] = [];
  let underlyingPrice: number | null = null;

  for (let page = 0; page < MAX_PAGES && nextUrl; page += 1) {
    const response = await fetch(nextUrl.toString(), {
      headers: { Accept: "application/json" }
    });

    if (!response.ok) {
      const text = await response.text();
      return NextResponse.json(
        { message: "Failed to fetch Massive snapshot", details: text },
        { status: 502 }
      );
    }

    const json = (await response.json()) as MassiveResponse;
    const pageRows = Array.isArray(json.results) ? json.results : [];
    pageRows.forEach((row) => {
      const isCall = row.details?.contract_type?.toLowerCase() === "call";
      if (!isCall) {
        return;
      }
      if (underlyingPrice === null) {
        const candidate = pickUnderlyingPrice(row);
        if (candidate !== null) {
          underlyingPrice = candidate;
        }
      }
      rows.push(row);
    });

    if (json.next_url) {
      try {
        nextUrl = new URL(json.next_url);
        ensureApiKey(nextUrl, apiKey);
      } catch (err) {
        nextUrl = null;
      }
    } else {
      nextUrl = null;
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const validExpirations = Array.from(
    new Set(
      rows
        .map((row) => row.details?.expiration_date)
        .filter((date): date is string => {
          if (typeof date !== "string") {
            return false;
          }
          return date >= today;
        })
    )
  )
    .sort()
    .slice(0, 10);

  const selected = rows.filter((row) =>
    row.details?.expiration_date && validExpirations.includes(row.details.expiration_date)
  );

  const options: OptionPoint[] = [];
  const spotForIntrinsic = underlyingPrice ?? 0;

  selected.forEach((row) => {
    const strike = parseNumber(row.details?.strike_price);
    if (strike === null) {
      return;
    }
    const bid = parseNumber(row.last_quote?.bid);
    const ask = parseNumber(row.last_quote?.ask);
    const lastTrade = parseNumber(row.last_trade?.price);
    const breakEvenFromApi = parseNumber(row.break_even_price);

    let premium: number | null = null;
    if (bid !== null && ask !== null) {
      premium = (bid + ask) / 2;
    } else if (lastTrade !== null) {
      premium = lastTrade;
    } else if (breakEvenFromApi !== null) {
      premium = breakEvenFromApi - strike;
    }

    if (premium === null || !Number.isFinite(premium)) {
      return;
    }

    const breakEven = breakEvenFromApi ?? strike + premium;
    const intrinsic = Math.max(spotForIntrinsic - strike, 0);
    const extrinsic = Math.max(premium - intrinsic, 0);

    options.push({
      ticker: row.details?.ticker?.trim() || ticker,
      strike,
      expiration: row.details?.expiration_date || "",
      premium,
      intrinsic,
      extrinsic,
      breakEven,
      target2x: strike + 2 * premium,
      target3x: strike + 3 * premium
    });
  });

  const payload: OptionsApiResponse = {
    underlyingPrice,
    expirations: validExpirations,
    options
  };

  return NextResponse.json(payload);
}
