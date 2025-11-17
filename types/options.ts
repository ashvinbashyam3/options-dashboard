export type OptionPoint = {
  ticker: string;
  strike: number;
  expiration: string;
  premium: number;
  intrinsic: number;
  extrinsic: number;
  breakEven: number;
  target2x: number;
  target3x: number;
};

export type OptionsApiResponse = {
  underlyingPrice: number | null;
  expirations: string[];
  options: OptionPoint[];
};
