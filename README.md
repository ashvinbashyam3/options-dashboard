# Options Payoff Map

Next.js 14 + TypeScript dashboard that fetches Massive option snapshot data and visualizes call option value, break-even, and 2×/3× payoff targets for the next 10 expirations.

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
