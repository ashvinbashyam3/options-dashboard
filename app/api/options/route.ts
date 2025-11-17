import { NextRequest, NextResponse } from "next/server";
import type { OptionPoint, OptionsApiResponse } from "@/types/options";

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
  };
  last_trade?: {
    price?: number | string;
  };
  underlying_asset?: MassiveUnderlyingSnapshot;
  day?: MassiveDaySnapshot;
};

type MassiveResponse = {
  results?: MassiveOptionRow[];
  next_url?: string | null;
  underlying_asset?: MassiveUnderlyingSnapshot | null;
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

const pickUnderlyingPrice = (
  snapshot?: MassiveUnderlyingSnapshot | MassiveDaySnapshot | null
): number | null => {
  if (!snapshot) {
    return null;
  }

  const candidates: Array<unknown> = [
    snapshot.price,
    snapshot.last_price,
    snapshot.close,
    snapshot.day_close,
  ];

  if ("c" in snapshot) {
    candidates.push(snapshot.c);
  }
  if ("last" in snapshot) {
    candidates.push(snapshot.last);
  }

  if ("last_trade" in snapshot) {
    candidates.push(snapshot.last_trade?.price, snapshot.last_trade?.p);
  }
  if ("day" in snapshot) {
    candidates.push(snapshot.day?.close, snapshot.day?.c);
  }
  if ("last_quote" in snapshot) {
    candidates.push(
      snapshot.last_quote?.bid,
      snapshot.last_quote?.bid_price,
      snapshot.last_quote?.ask,
      snapshot.last_quote?.ask_price,
      snapshot.last_quote?.mid,
      snapshot.last_quote?.midpoint
    );
  }

  for (const candidate of candidates) {
    const parsed = parseNumber(candidate);
    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
};

const pickUnderlyingFromRow = (row: MassiveOptionRow): number | null => {
  return (
    pickUnderlyingPrice(row.underlying_asset) ??
    pickUnderlyingPrice(row.day ?? null)
  );
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

  const authHeaders = {
    Accept: "application/json",
    Authorization: `Bearer ${apiKey}`
  } as const;

  for (let page = 0; page < MAX_PAGES && nextUrl; page += 1) {
    const response = await fetch(nextUrl.toString(), {
      headers: authHeaders,
      cache: "no-store"
    });

    if (!response.ok) {
      const text = await response.text();
      return NextResponse.json(
        {
          message: "Failed to fetch Massive snapshot",
          statusCode: response.status,
          details: text
        },
        { status: 502 }
      );
    }

    const json = (await response.json()) as MassiveResponse;
    if (underlyingPrice === null) {
      const snapshotCandidate = pickUnderlyingPrice(json.underlying_asset);
      if (snapshotCandidate !== null) {
        underlyingPrice = snapshotCandidate;
      }
    }

    const pageRows = Array.isArray(json.results) ? json.results : [];
    pageRows.forEach((row) => {
      const isCall = row.details?.contract_type?.toLowerCase() === "call";
      if (!isCall) {
        return;
      }
      if (underlyingPrice === null) {
        const candidate = pickUnderlyingFromRow(row);
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
