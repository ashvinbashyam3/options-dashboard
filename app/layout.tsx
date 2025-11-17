import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Options Payoff Map",
  description:
    "Visualize intrinsic/extrinsic value, break-even levels, and payoff targets for call options across the next expirations."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
