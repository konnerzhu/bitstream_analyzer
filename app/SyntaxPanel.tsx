"use client";

import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { Locale } from "./i18n";
import { getCopy } from "./i18n";
import {
  MAX_SYNTAX_QUERY_LENGTH,
  MAX_SYNTAX_SEARCH_RESULTS,
  SyntaxNode,
  SyntaxReport,
  searchSyntaxTree,
} from "./syntax-tree";

function formatSource(node: Pick<SyntaxNode, "source">, locale: Locale) {
  const range = node.source;
  if (!range) return locale === "en" ? "derived" : "派生值";
  const bit = range.bitOffset !== undefined ? ` · bit ${range.bitOffset}${range.bitLength !== undefined ? `:${range.bitLength}` : ""}` : "";
  return `0x${range.byteOffset.toString(16).padStart(8, "0")} · ${range.byteLength} B${bit}`;
}

function valueText(value: SyntaxNode["value"]) {
  if (value === undefined) return "";
  if (typeof value === "boolean") return value ? "1 (true)" : "0 (false)";
  return String(value);
}

function TreeNodeView({ node, locale, depth = 0 }: { node: SyntaxNode; locale: Locale; depth?: number }) {
  const hasChildren = node.children.length > 0;
  if (!hasChildren) {
    return <div className="syntax-leaf" style={{ "--syntax-depth": depth } as CSSProperties}>
      <code>{node.name}</code><strong>{valueText(node.value)}</strong><small>{formatSource(node, locale)}</small>
    </div>;
  }
  return <details className="syntax-branch" open={depth < 1}>
    <summary><code>{node.name}</code>{node.value !== undefined && <strong>{valueText(node.value)}</strong>}<small>{node.children.length.toLocaleString(locale === "en" ? "en-US" : "zh-CN")}</small></summary>
    <div>{node.children.map(child => <TreeNodeView key={child.id} node={child} locale={locale} depth={depth + 1} />)}</div>
  </details>;
}

export function SyntaxPanel({ report, selectedUnitIndex, onSelectUnit, locale }: {
  report: SyntaxReport;
  selectedUnitIndex?: number;
  onSelectUnit: (index: number) => void;
  locale: Locale;
}) {
  const copy = getCopy(locale);
  const [query, setQuery] = useState("");
  const results = useMemo(() => searchSyntaxTree(report, query), [query, report]);
  const overview = report.root.children.filter(node => node.path !== "stream.units");
  const selectedUnit = useMemo(() => report.searchIndex.find(entry => entry.node.kind === "unit" && entry.node.unitIndex === selectedUnitIndex)?.node, [report, selectedUnitIndex]);

  return <section className="syntax-card">
    <div className="section-title"><div><span>04</span><h3>{copy.syntaxTree}</h3></div><small>{report.nodeCount.toLocaleString(locale === "en" ? "en-US" : "zh-CN")} {copy.syntaxNodes}</small></div>
    <label className="syntax-search">
      <span>{copy.searchSyntax}</span>
      <input type="search" value={query} maxLength={MAX_SYNTAX_QUERY_LENGTH} onChange={event => setQuery(event.target.value)} placeholder={copy.searchSyntaxPlaceholder} />
      {query && <small>{results.length.toLocaleString(locale === "en" ? "en-US" : "zh-CN")}{results.length === MAX_SYNTAX_SEARCH_RESULTS ? "+" : ""} {copy.matches}</small>}
    </label>
    {query ? <div className="syntax-results">
      {results.length ? results.map(node => <button key={node.id} onClick={() => node.unitIndex !== undefined && onSelectUnit(node.unitIndex)} disabled={node.unitIndex === undefined}>
        <code>{node.path}</code><strong>{node.name}{node.value !== undefined ? ` = ${valueText(node.value)}` : ""}</strong><small>{formatSource(node, locale)}</small>
      </button>) : <p>{copy.noSyntaxMatches}</p>}
    </div> : <div className="syntax-browser">
      <div>{overview.map(node => <TreeNodeView key={node.id} node={node} locale={locale} />)}</div>
      <div>{selectedUnit ? <TreeNodeView node={selectedUnit} locale={locale} /> : <p>{copy.selectSyntaxUnit}</p>}</div>
    </div>}
  </section>;
}
