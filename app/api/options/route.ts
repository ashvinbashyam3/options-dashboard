import { NextRequest, NextResponse } from "next/server";
import type { OptionPoint, OptionsApiResponse } from "@/types/options";

// --- Massive API Response Types (unchanged) ---
type BaseNumericSnapshot = {
  price?: number | string;
  last_price?: number | string;
  close?: number | string;
  day_close?: number | string;
};

type MassiveUnderlyingSnapshot = BaseNumericSnapshot & {
  last_trade?: { price?: number | string; p?: number | string };
  day?: { close?: number | string; c?: number | string };
  last_quote?: {
    bid?: number | string;
    bid_price?: number | string;
    ask?: number | string;
    ask_price?: number | string;
    mid?: number | string;
    midpoint?: number | string;
  };
};

type MassiveDaySnapshot = BaseNumericSnapshot & {
  c?: number | string;
  last?: number | string;
};

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
    bid_price?: number | string;
    ask_price?: number | string;
    mid?: number | string;
    midpoint?: number | string;
    mark?: number | string;
    mark_price?: number | string;
  };
  last_trade?: {
    price?: number | string;
  };
  underlying_asset?: MassiveUnderlyingSnapshot;
  day?: MassiveDaySnapshot;
};

type MassiveOptionsResponse = {
  results?: MassiveOptionRow[];
  next_url?: string | null;
};

// --- NEW: Massive API Quote Response Type (Corrected) ---
type MassiveQuote = {
  session?: {
    price?: number;
    close?: number;
    previous_close?: number;
  };
};

type MassiveQuoteResponse = {
  results?: MassiveQuote[];
  status?: string;
};

const MAX_PAGES = 15;
const MASSIVE_BASE_URL = "https://api.massive.com/v3";

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

const firstNumber = (values: Array<unknown>) => {
  for (const candidate of values) {
    const parsed = parseNumber(candidate);
    if (parsed !== null) {
      return parsed;
    }
  }
  return null;
};

const ensureApiKey = (url: URL, apiKey: string) => {
  if (!url.searchParams.has("apiKey")) {
    url.searchParams.append("apiKey", apiKey);
  }
};

/**
 * Extracts a reliable spot price from a Massive.com quote response.
 * It prioritizes the last known price from the session, then the session's
 * close, and finally falls back to the previous day's close.
 * @param quote The quote object from the Massive API response.
 * @returns A numeric spot price or null if none could be determined.
 */
const getUnderlyingSpotFromQuote = (quote: MassiveQuote): number | null => {
  if (!quote?.session) {
    return null;
  }

  const candidates = [
    // 1. Most recent price for the session
    quote.session.price,
    // 2. Today's closing price
    quote.session.close,
    // 3. Previous day's closing price (fallback)
    quote.session.previous_close,
  ];

  for (const candidate of candidates) {
    const price = parseNumber(candidate);
    if (price !== null && price > 0) {
      return price;
    }
  }

  return null;
};

async function fetchUnderlyingQuote(ticker: string, apiKey: string): Promise<number | null> {
  const url = new URL(`${MASSIVE_BASE_URL}/snapshot`);
  url.searchParams.set("ticker", ticker);
  ensureApiKey(url, apiKey);

  const urlString = url.toString();
  console.log(`[api/options] Fetching underlying quote from: ${urlString}`);

  const response = await fetch(urlString, {
    headers: { Accept: "application/json", Authorization: `Bearer ${apiKey}` },
    cache: "no-store",
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(
      `[api/options] Failed to fetch underlying quote for ${ticker}. URL: ${urlString}, Status: ${response.status}, Response: ${errorText}`
    );
    return null;
  }

  const json = (await response.json()) as MassiveQuoteResponse;
  const quoteResult = json.results?.[0];
  if (!quoteResult) {
    console.error(`[api/options] Underlying quote response for ${ticker} was empty or invalid.`);
    return null;
  }
  return getUnderlyingSpotFromQuote(quoteResult);
}

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

  console.log(`[api/options] Fetching data for ${ticker}`);

  // --- Step 1: Fetch the true underlying spot price ---
  const underlyingSpot = await fetchUnderlyingQuote(ticker, apiKey);
  if (underlyingSpot === null) {
    return NextResponse.json(
      { message: `Could not retrieve underlying stock quote for ${ticker}. The symbol may be invalid.` },
      { status: 404 }
    );
  }
  console.log(`[api/options] Fetched underlying spot price: ${underlyingSpot}`);

  // --- Step 2: Fetch the options chain ---
  let nextUrl: URL | null = new URL(`${MASSIVE_BASE_URL}/snapshot/options/${encodeURIComponent(ticker)}`);
  nextUrl.searchParams.set("limit", "250");
  nextUrl.searchParams.set("contract_type", "call");
  ensureApiKey(nextUrl, apiKey);

  const rows: MassiveOptionRow[] = [];
  const authHeaders = { Accept: "application/json", Authorization: `Bearer ${apiKey}` } as const;

  for (let page = 0; page < MAX_PAGES && nextUrl; page += 1) {
    console.log(`[api/options] Fetching options page ${page + 1}: ${nextUrl}`);
    const response = await fetch(nextUrl.toString(), { headers: authHeaders, cache: "no-store" });

    if (!response.ok) {
      const text = await response.text();
      console.error(`[api/options] Massive options API responded with ${response.status}: ${text}`);
      return NextResponse.json(
        { message: "Failed to fetch options chain snapshot", statusCode: response.status, details: text },
        { status: 502 }
      );
    }

    const json = (await response.json()) as MassiveOptionsResponse;
    const pageRows = Array.isArray(json.results) ? json.results.filter(r => r.details?.contract_type?.toLowerCase() === 'call') : [];
    rows.push(...pageRows);

    nextUrl = json.next_url ? new URL(json.next_url) : null;
    if (nextUrl) ensureApiKey(nextUrl, apiKey);
  }

  // --- Step 3: Process and enrich the options data ---
  const today = new Date().toISOString().slice(0, 10);
  const expirationCandidates: string[] = rows.flatMap((row) => {
    const expiration = row.details?.expiration_date;
    return typeof expiration === "string" ? [expiration] : [];
  });

  const validExpirations = Array.from(
    new Set(expirationCandidates.filter((date) => date >= today))
  )
    .sort()
    .slice(0, 10);

  const selected = rows.filter((row) =>
    row.details?.expiration_date && validExpirations.includes(row.details.expiration_date)
  );

  const options: OptionPoint[] = [];
  // CRITICAL FIX: Use the accurate underlyingSpot for all calculations.
  const spotForIntrinsic = underlyingSpot;

  selected.forEach((row) => {
    const strike = parseNumber(row.details?.strike_price);
    if (strike === null) {
      console.warn("[api/options] Skipping row without strike", row.details);
      return;
    }
    const bid = firstNumber([row.last_quote?.bid, row.last_quote?.bid_price]);
    const ask = firstNumber([row.last_quote?.ask, row.last_quote?.ask_price]);
    const mid = firstNumber([
      row.last_quote?.mid,
      row.last_quote?.midpoint,
      row.last_quote?.mark,
      row.last_quote?.mark_price
    ]);
    const lastTrade = parseNumber(row.last_trade?.price);
    const dayClose = firstNumber([
      row.day?.close,
      row.day?.c,
      row.day?.last,
      row.day?.price,
      row.day?.last_price
    ]);
    const breakEvenFromApi = parseNumber(row.break_even_price);

    let premium: number | null = null;
    if (bid !== null && ask !== null) {
      premium = (bid + ask) / 2;
    } else if (mid !== null) {
      premium = mid;
    } else if (lastTrade !== null) {
      premium = lastTrade;
    } else if (dayClose !== null) {
      premium = dayClose;
    } else if (breakEvenFromApi !== null) {
      premium = breakEvenFromApi - strike;
    }

    if (premium === null || !Number.isFinite(premium) || premium < 0) {
      return; // Skip options with no valid premium
    }

    const breakEven = breakEvenFromApi ?? strike + premium;
    // CRITICAL FIX: Intrinsic value is now calculated with the correct spot price.
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
    underlyingSpot, // Use the new field name for clarity
    expirations: validExpirations,
    options
  };

  console.log(
    `[api/options] Returning ${payload.options.length} options across ${payload.expirations.length} expirations for ${ticker}`
  );

  return NextResponse.json(payload);
}
