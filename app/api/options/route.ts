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

const sanitizeNumericString = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  // Remove currency symbols, commas, and any other non numeric characters
  const stripped = trimmed.replace(/[,$]/g, "");
  const cleaned = stripped.replace(/[^0-9eE+\-.]/g, "");
  return cleaned;
};

const parseNumber = (value: unknown, debugContext?: string): number | null => {
  if (value === null || value === undefined) {
    return null;
  }

  let num: number | null = null;

  if (typeof value === "number") {
    num = Number.isFinite(value) ? value : null;
  } else if (typeof value === "string") {
    const sanitized = sanitizeNumericString(value);
    if (!sanitized || sanitized === "-" || sanitized === "." || sanitized === "-." || sanitized === "+") {
      num = null;
    } else {
      const parsed = Number(sanitized);
      num = Number.isFinite(parsed) ? parsed : null;
    }
  }

  if (num === null && debugContext) {
    console.warn(`[api/options] Unable to parse numeric value for ${debugContext}:`, value);
  }

  return num;
};

type Candidate = { value: unknown; source: string };

const pickUnderlyingPrice = (
  snapshot?: MassiveUnderlyingSnapshot | MassiveDaySnapshot | null,
  context = "snapshot"
): number | null => {
  if (!snapshot) {
    return null;
  }

  const candidates: Candidate[] = [
    { value: snapshot.price, source: `${context}.price` },
    { value: snapshot.last_price, source: `${context}.last_price` },
    { value: snapshot.close, source: `${context}.close` },
    { value: snapshot.day_close, source: `${context}.day_close` },
  ];

  if ("c" in snapshot) {
    candidates.push({ value: snapshot.c, source: `${context}.c` });
  }
  if ("last" in snapshot) {
    candidates.push({ value: snapshot.last, source: `${context}.last` });
  }
  if ("last_price" in snapshot) {
    candidates.push({
      value: (snapshot as MassiveDaySnapshot).last_price,
      source: `${context}.last_price_alias`,
    });
  }
  if ("price" in snapshot) {
    candidates.push({ value: (snapshot as MassiveDaySnapshot).price, source: `${context}.price_alias` });
  }

  if ("last_trade" in snapshot) {
    candidates.push(
      { value: snapshot.last_trade?.price, source: `${context}.last_trade.price` },
      { value: snapshot.last_trade?.p, source: `${context}.last_trade.p` }
    );
  }
  if ("day" in snapshot) {
    candidates.push(
      { value: snapshot.day?.close, source: `${context}.day.close` },
      { value: snapshot.day?.c, source: `${context}.day.c` },
      { value: snapshot.day?.last, source: `${context}.day.last` },
      { value: snapshot.day?.last_price, source: `${context}.day.last_price` },
      { value: snapshot.day?.price, source: `${context}.day.price` }
    );
  }
  if ("last_quote" in snapshot) {
    candidates.push(
      { value: snapshot.last_quote?.bid, source: `${context}.last_quote.bid` },
      { value: snapshot.last_quote?.bid_price, source: `${context}.last_quote.bid_price` },
      { value: snapshot.last_quote?.ask, source: `${context}.last_quote.ask` },
      { value: snapshot.last_quote?.ask_price, source: `${context}.last_quote.ask_price` },
      { value: snapshot.last_quote?.mid, source: `${context}.last_quote.mid` },
      { value: snapshot.last_quote?.midpoint, source: `${context}.last_quote.midpoint` }
    );
  }

  for (const candidate of candidates) {
    const parsed = parseNumber(candidate.value, candidate.source);
    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
};

const pickUnderlyingFromRow = (row: MassiveOptionRow, context: string): number | null => {
  return pickUnderlyingPrice(row.underlying_asset, context);
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
      const snapshotCandidate = pickUnderlyingPrice(
        json.underlying_asset,
        `page${page + 1}.underlying`
      );
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
        const candidate = pickUnderlyingFromRow(
          row,
          `row.${row.details?.ticker ?? "unknown"}`
        );
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
      `[api/options] No underlying price detected after ${rows.length} rows for ${ticker}`
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
