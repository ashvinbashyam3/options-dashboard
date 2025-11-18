# Options Payoff Map

Next.js 14 + TypeScript dashboard that fetches Massive option snapshot data and visualizes call option value, break-even, and 2×/3×/4× payoff targets for the next 20 expirations.

## Project Description

This project, the "Options Payoff Map," is a dynamic data visualization tool built with Next.js 14 and TypeScript. It is designed to help users, such as financial analysts or retail traders, quickly understand the potential payoff and risk profile of call options for a given stock ticker. The application fetches near real-time option chain data from the "Massive" API and presents it in a user-friendly dashboard format. The core of the application is a series of charts, each representing one of the next ten expiration dates, which allows for easy comparison of option characteristics across time.

### How It Works

The application follows a modern client-server architecture, leveraging the features of the Next.js framework. The data flow is as follows:

1.  **User Interaction:** The user provides a stock ticker symbol in an input field. On submission, the frontend triggers a data fetch.
2.  **API Proxy Route:** A client-side `fetch` request is made to a local Next.js API route (`/api/options`). This route acts as a proxy, securely handling communication with the external "Massive" API. This design prevents the `MASSIVE_API_KEY` from being exposed in the browser.
3.  **External Data Fetching:** The API route, running on the server, makes a request to the "Massive" API, forwarding the user's ticker symbol and authenticating with the necessary API key.
4.  **Data Processing and Response:** Upon receiving the data, the API route sends it back to the client as a JSON payload.
5.  **Client-Side Rendering:** The React frontend, written in TypeScript, parses the JSON data. It then uses the `recharts` library to render the data into a series of charts. A `rc-slider` component allows the user to interactively filter the range of strike prices shown, providing a more focused analysis.

### Features and Design Decisions

*   **Technology Stack:**
    *   **Next.js 14:** The framework provides a robust foundation with its App Router for clean, file-system-based routing and server-side API routes for secure data fetching.
    *   **TypeScript:** Enforces type safety, which is crucial for managing complex financial data structures and preventing runtime errors.
    *   **Recharts:** A composable charting library that offers the flexibility needed to build the specific visualizations for the option payoff maps.
    *   **`rc-slider`:** A lightweight and customizable slider component for the strike price filtering feature.

*   **Key Visualizations:** The charts are the core feature of the application. For each of the next ten expiration dates, a chart is rendered to visualize:
    *   **Option Value:** The premium of the call option.
    *   **Intrinsic vs. Extrinsic Value:** The breakdown of the option's price into its intrinsic value (the value if exercised immediately) and its extrinsic value (the "time value").
    *   **Break-Even Point:** The stock price at which the position becomes profitable.
    *   **Payoff Targets:** Markers indicating the underlying stock price required to achieve a 2x or 3x return on the option premium.

### Non-Obvious Code Implementation Details

*   **API as a Proxy:** The use of a Next.js API route as a proxy is a deliberate security measure. It abstracts the external data source and protects the API key.
*   **Client-Side Data Grouping:** The fetched option data is a flat list. The application processes this list on the client side to group the options by their expiration dates before rendering the charts. For very large datasets, this operation could be moved to the server-side API route to optimize frontend performance.
*   **Initial State and Default Ticker:** The application is initialized with a default ticker ("AAPL") and fetches its option chain on the initial page load. This provides immediate, useful content to the user without requiring them to take any action.
*   **Interactive Filtering:** The strike price range slider does not trigger a new API call. Instead, it filters the already-fetched data on the client side, which makes the filtering action instantaneous.
*   **Styling:** The project uses a combination of inline styles and a global stylesheet. This is a straightforward approach suitable for a single-page application, but in a larger project, a more modular solution like CSS Modules might be preferred.

## Getting started

1. Install dependencies

```bash
npm install
```

2. Configure your Massive API key in `.env.local`

```
MASSIVE_API_KEY=your_key_here
```

3. Run the dev server

```bash
npm run dev
```

## Deploying to Vercel

1. Push this repository to GitHub.
2. Import the repo into Vercel and select the Next.js framework preset.
3. In Vercel project settings, add `MASSIVE_API_KEY` to the Environment Variables for the Production (and optionally Preview/Development) environments.
4. Deploy — Vercel will build and host the site automatically.
