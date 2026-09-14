import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import Analyzer from "../../app/Analyzer";
import type { Locale } from "../../app/i18n";
import "../../app/globals.css";
import "../../app/analyzer.css";

function localeFromEnvironment(): Locale {
  if (window.location.hash.toLowerCase().includes("zh-cn")) return "zh-CN";
  if (window.location.hash.toLowerCase().includes("en")) return "en";
  return navigator.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

function DesktopApp() {
  const [locale, setLocale] = useState<Locale>(localeFromEnvironment);
  useEffect(() => {
    const updateLocale = () => setLocale(localeFromEnvironment());
    window.addEventListener("hashchange", updateLocale);
    return () => window.removeEventListener("hashchange", updateLocale);
  }, []);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  return <Analyzer locale={locale} />;
}

const root = document.getElementById("root");
if (!root) throw new Error("Desktop renderer root is missing");
createRoot(root).render(<DesktopApp />);
