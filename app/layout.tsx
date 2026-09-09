import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import "./analyzer.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const rawHost = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const host = /^[a-z0-9.:-]+$/i.test(rawHost) ? rawHost : "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") === "https" ? "https" : host.startsWith("localhost") ? "http" : "https";
  const image = `${protocol}://${host}/og.png`;
  const title = "BitScope · 多编码码流分析器";
  const description = "在浏览器本地分析 H.264、H.265、H.266 和 AV1 码流，查看参数集、NAL/OBU、帧结构与编码块。";
  return {
    title, description,
    openGraph: { title, description, images: [{ url: image, width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN"><body>{children}</body></html>
  );
}
