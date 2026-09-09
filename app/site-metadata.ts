import type { Metadata } from "next";
import { headers } from "next/headers";
import type { Locale } from "./i18n";

const metadataCopy = {
  en: {
    title: "BitScope · Multi-codec bitstream analyzer",
    description: "Analyze H.264, H.265, H.266, and AV1 bitstreams locally in your browser. Inspect parameter sets, NAL/OBU units, frame structure, and coding blocks.",
  },
  "zh-CN": {
    title: "BitScope · 多编码码流分析器",
    description: "在浏览器本地分析 H.264、H.265、H.266 和 AV1 码流，查看参数集、NAL/OBU、帧结构与编码块。",
  },
} satisfies Record<Locale, { title: string; description: string }>;

export async function createMetadata(locale: Locale): Promise<Metadata> {
  const requestHeaders = await headers();
  const rawHost = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const host = /^[a-z0-9.:-]+$/i.test(rawHost) ? rawHost : "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") === "https" ? "https" : host.startsWith("localhost") ? "http" : "https";
  const metadataBase = new URL(`${protocol}://${host}`);
  const pathname = locale === "en" ? "/" : "/zh-CN";
  const copy = metadataCopy[locale];

  return {
    metadataBase,
    title: copy.title,
    description: copy.description,
    alternates: {
      canonical: pathname,
      languages: { en: "/", "zh-CN": "/zh-CN" },
    },
    openGraph: {
      title: copy.title,
      description: copy.description,
      locale: locale === "en" ? "en_US" : "zh_CN",
      url: pathname,
      images: [{ url: "/og.png", width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title: copy.title,
      description: copy.description,
      images: ["/og.png"],
    },
  };
}
