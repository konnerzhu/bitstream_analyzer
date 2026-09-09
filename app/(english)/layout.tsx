import type { Metadata } from "next";
import "../globals.css";
import "../analyzer.css";
import { createMetadata } from "../site-metadata";

export function generateMetadata(): Promise<Metadata> {
  return createMetadata("en");
}

export default function EnglishLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
