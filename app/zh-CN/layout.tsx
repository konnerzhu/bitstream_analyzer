import type { Metadata } from "next";
import "../globals.css";
import "../analyzer.css";
import { createMetadata } from "../site-metadata";

export function generateMetadata(): Promise<Metadata> {
  return createMetadata("zh-CN");
}

export default function SimplifiedChineseLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
