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
  day?: {
    close?: number | string;
    c?: number | string;
    last?: number | string;
    last_price?: number | string;
    price?: number | string;
  };
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
  last_price?: number | string;
  price?: number | string;
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

type MassiveResponse = {
  results?: MassiveOptionRow[];
  next_url?: string | null;
  underlying_asset?: MassiveUnderlyingSnapshot | null;
};

const MAX_PAGES = 15;
const MASSIVE_BASE = "https://api.massive.com/v3/snapshot/options/";
const MASSIVE_STOCK_SNAPSHOT_ENDPOINT = "https://api.massive.com/v3/snapshot/stocks";

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

const PRICE_KEY_PATTERNS = [
  /price/i,
  /close/i,
  /last/i,
  /trade/i,
  /bid/i,
  /ask/i
];

const PRICE_KEY_EXCLUSIONS = [/strike/i, /premium/i, /option/i];

const isPriceLikeKey = (key: string) => {
  if (!key) return false;
  if (PRICE_KEY_EXCLUSIONS.some((regex) => regex.test(key))) {
    return false;
  }
  return PRICE_KEY_PATTERNS.some((regex) => regex.test(key));
};

const collectPriceCandidates = (value: unknown, depth = 0): Array<unknown> => {
  if (depth > 4 || value === null || value === undefined) {
    return [];
  }
  if (typeof value === "number" || typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectPriceCandidates(entry, depth + 1));
  }
  if (typeof value === "object") {
    const entries: Array<unknown> = [];
    for (const [key, entry] of Object.entries(value)) {
      if (isPriceLikeKey(key)) {
        entries.push(entry);
      }
      if (typeof entry === "object") {
        entries.push(...collectPriceCandidates(entry, depth + 1));
      }
    }
    return entries;
  }
  return [];
};

const pickUnderlyingPrice = (
  snapshot?: MassiveUnderlyingSnapshot | MassiveDaySnapshot | null,
  debugLabel?: string
): number | null => {
  if (!snapshot) {
    return null;
  }

  const directCandidates: Array<unknown> = [
    snapshot.price,
    snapshot.last_price,
    snapshot.close,
    snapshot.day_close,
  ];

  if ("c" in snapshot) {
    directCandidates.push(snapshot.c);
  }
  if ("last" in snapshot) {
    directCandidates.push(snapshot.last);
  }
  if ("last_price" in snapshot) {
    directCandidates.push((snapshot as MassiveDaySnapshot).last_price);
  }
  if ("price" in snapshot) {
    directCandidates.push((snapshot as MassiveDaySnapshot).price);
  }

  if ("last_trade" in snapshot) {
    directCandidates.push(snapshot.last_trade?.price, snapshot.last_trade?.p);
  }
  if ("day" in snapshot) {
    directCandidates.push(
      snapshot.day?.close,
      snapshot.day?.c,
      snapshot.day?.last,
      snapshot.day?.last_price,
      snapshot.day?.price
    );
  }
  if ("last_quote" in snapshot) {
    directCandidates.push(
      snapshot.last_quote?.bid,
      snapshot.last_quote?.bid_price,
      snapshot.last_quote?.ask,
      snapshot.last_quote?.ask_price,
      snapshot.last_quote?.mid,
      snapshot.last_quote?.midpoint
    );
  }

  const recursiveCandidates = collectPriceCandidates(snapshot);
  const combined = [...directCandidates, ...recursiveCandidates];

  for (const candidate of combined) {
    const parsed = parseNumber(candidate);
    if (parsed !== null) {
      if (debugLabel) {
        console.log(
          `[api/options] Underlying candidate ${parsed} selected from ${debugLabel}`
        );
      }
      return parsed;
    }
  }

  if (debugLabel) {
    console.warn(`[api/options] No numeric price discovered in ${debugLabel}`);
  }

  return null;
};

const pickUnderlyingFromRow = (row: MassiveOptionRow): number | null => {
  return pickUnderlyingPrice(row.underlying_asset, "row.underlying_asset");
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

const fetchUnderlyingFallback = async (
  ticker: string,
  apiKey: string,
  headers: Record<string, string>
): Promise<number | null> => {
  const attempts: URL[] = [];

  const pathStyle = new URL(
    `${MASSIVE_STOCK_SNAPSHOT_ENDPOINT}/${encodeURIComponent(ticker)}`
  );
  pathStyle.searchParams.set("limit", "1");
  ensureApiKey(pathStyle, apiKey);
  attempts.push(pathStyle);

  const queryStyle = new URL(MASSIVE_STOCK_SNAPSHOT_ENDPOINT);
  queryStyle.searchParams.set("limit", "1");
  queryStyle.searchParams.set("ticker", ticker);
  ensureApiKey(queryStyle, apiKey);
  attempts.push(queryStyle);

  for (let index = 0; index < attempts.length; index += 1) {
    const url = attempts[index];
    console.warn(
      `[api/options] Stock snapshot fallback attempt ${index + 1}/${attempts.length} for ${ticker}: ${url.toString()}`
    );
    try {
      const response = await fetch(url.toString(), { headers, cache: "no-store" });
      if (!response.ok) {
        const text = await response.text();
        console.error(
          `[api/options] Stock snapshot fallback request failed with ${response.status}: ${text}`
        );
        continue;
      }
      const json = (await response.json()) as {
        results?: MassiveUnderlyingSnapshot[];
      };
      const snapshots = Array.isArray(json.results) ? json.results : [];
      console.log(
        `[api/options] Stock snapshot fallback attempt ${index + 1} returned ${snapshots.length} entries for ${ticker}`
      );
      for (const snapshot of snapshots) {
        const candidate = pickUnderlyingPrice(snapshot, `stockSnapshotAttempt${index + 1}`);
        if (candidate !== null) {
          console.log(
            `[api/options] Stock snapshot fallback detected underlying price ${candidate} for ${ticker}`
          );
          return candidate;
        }
      }
    } catch (error) {
      console.error(
        `[api/options] Stock snapshot fallback attempt ${index + 1} threw:`,
        error
      );
    }
  }
  console.warn(`[api/options] Stock snapshot fallback did not yield a price for ${ticker}`);
  return null;
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

  console.log(`[api/options] Fetching Massive snapshot for ${ticker}`);

  let nextUrl: URL | null = new URL(`${MASSIVE_BASE}${encodeURIComponent(ticker)}`);
  nextUrl.searchParams.set("limit", "250");
  nextUrl.searchParams.set("contract_type", "call");
  ensureApiKey(nextUrl, apiKey);

  const rows: MassiveOptionRow[] = [];
  let underlyingPrice: number | null = null;
  const ROW_UNDERLYING_LOG_LIMIT = 5;
  let rowUnderlyingDebugs = 0;

  const authHeaders = {
    Accept: "application/json",
    Authorization: `Bearer ${apiKey}`
  } as const;

  for (let page = 0; page < MAX_PAGES && nextUrl; page += 1) {
    console.log(`[api/options] Page ${page + 1}: ${nextUrl}`);
    const response = await fetch(nextUrl.toString(), {
      headers: authHeaders,
      cache: "no-store"
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(
        `[api/options] Massive responded with ${response.status} on page ${page + 1}: ${text}`
      );
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
    console.log(
      `[api/options] Page ${page + 1} underlying snapshot payload:`,
      json.underlying_asset ?? null
    );
    if (underlyingPrice === null) {
      const snapshotCandidate = pickUnderlyingPrice(json.underlying_asset);
      if (snapshotCandidate !== null) {
        underlyingPrice = snapshotCandidate;
        console.log(`[api/options] Underlying snapshot price detected: ${underlyingPrice}`);
      } else if (json.underlying_asset) {
        console.warn(
          `[api/options] Unable to parse price from page ${page + 1} snapshot`,
          json.underlying_asset
        );
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
          console.log(`[api/options] Underlying price derived from row: ${underlyingPrice}`);
        } else if (row.underlying_asset && rowUnderlyingDebugs < ROW_UNDERLYING_LOG_LIMIT) {
          rowUnderlyingDebugs += 1;
          console.warn(
            `[api/options] Row underlying snapshot missing price (sample ${rowUnderlyingDebugs}/${ROW_UNDERLYING_LOG_LIMIT})`,
            row.underlying_asset
          );
        }
      }
      rows.push(row);
    });
    console.log(
      `[api/options] Page ${page + 1} yielded ${pageRows.length} rows (total so far: ${rows.length})`
    );

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

  if (underlyingPrice === null) {
    console.warn(
      `[api/options] No underlying price detected after ${rows.length} rows for ${ticker}; invoking fallback`
    );
    underlyingPrice = await fetchUnderlyingFallback(ticker, apiKey, authHeaders);
  }

  if (underlyingPrice === null) {
    console.warn(
      `[api/options] Underlying price still unavailable after fallback for ${ticker}`
    );
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

  console.log(
    `[api/options] Returning ${payload.options.length} options across ${payload.expirations.length} expirations`
  );
  console.log(`[api/options] Final underlyingPrice sent to client: ${underlyingPrice}`);

  return NextResponse.json(payload);
}
