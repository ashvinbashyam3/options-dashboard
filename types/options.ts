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
  target4x: number;
};

export type OptionsApiResponse = {
  underlyingSpot: number;
  expirations: string[];
  options: OptionPoint[];
};
