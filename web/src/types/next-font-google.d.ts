declare module "next/font/google" {
  type FontOptions = {
    subsets?: string[];
    weight?: string | string[];
    variable?: string;
    display?: "auto" | "block" | "swap" | "fallback" | "optional";
  };

  type FontResult = {
    className: string;
    style: { fontFamily: string };
    variable: string;
  };

  export function Syne(options?: FontOptions): FontResult;
  export function DM_Sans(options?: FontOptions): FontResult;
  export function JetBrains_Mono(options?: FontOptions): FontResult;
}
