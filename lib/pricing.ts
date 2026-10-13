/**
 * Deterministic pricing and catalog validation.
 *
 * This module is the money boundary. It runs on the server, on merchant-authored
 * catalog data, and is the only place a total is produced. Model output can
 * select catalog item IDs and quantities; it can never set a price.
 */
import { CATALOG, findCatalogItem } from './catalog.js';
import type { Catalog, ScopeLine } from './schemas.js';

export interface LineValidationResult {
  ok: boolean;
  lines: ScopeLine[];
  errors: string[];
}

/**
 * Validate proposed lines against the catalog:
 *  - the catalog item must exist
 *  - quantity must be a positive integer inside the merchant's min/max
 *  - the same catalog item may not appear twice
 *  - a source span, when present, must quote the brief text at the stated offsets
 */
export function validateLines(
  proposed: ScopeLine[],
  briefText: string,
  catalog: Catalog = CATALOG
): LineValidationResult {
  const errors: string[] = [];
  const seen = new Map<string, ScopeLine>();

  for (const line of proposed) {
    const item = catalog.items.find((candidate) => candidate.id === line.catalogItemId);
    if (!item) {
      errors.push(`Unknown catalog item "${line.catalogItemId}" is not sold by this merchant.`);
      continue;
    }
    if (!Number.isInteger(line.quantity) || line.quantity < 1) {
      errors.push(`Quantity for "${item.id}" must be a positive whole number.`);
      continue;
    }
    if (line.quantity < item.minQty || line.quantity > item.maxQty) {
      errors.push(
        `Quantity ${line.quantity} for "${item.label}" is outside the catalog range ${item.minQty}-${item.maxQty}.`
      );
      continue;
    }
    if (seen.has(item.id)) {
      errors.push(`"${item.label}" appears twice; quantities must be combined into one line.`);
      continue;
    }
    if (line.sourceSpan) {
      const { start, end, quote } = line.sourceSpan;
      if (start < 0 || end <= start || end > briefText.length) {
        errors.push(`Source span for "${item.id}" is outside the brief text.`);
        continue;
      }
      const actual = briefText.slice(start, end);
      if (actual !== quote) {
        errors.push(`Source span for "${item.id}" does not match the brief text it claims to quote.`);
        continue;
      }
    }
    seen.set(item.id, line);
  }

  return { ok: errors.length === 0, lines: [...seen.values()], errors };
}

/** Total in integer cents. Unknown items contribute nothing and are reported by validateLines. */
export function computeAmountMinor(lines: ScopeLine[], catalog: Catalog = CATALOG): number {
  let total = 0;
  for (const line of lines) {
    const item = catalog.items.find((candidate) => candidate.id === line.catalogItemId);
    if (!item) continue;
    total += item.unitPriceMinor * line.quantity;
  }
  return total;
}

export interface PriceBreakdownRow {
  catalogItemId: string;
  label: string;
  quantity: number;
  unit: string;
  unitPriceMinor: number;
  lineTotalMinor: number;
  deliverable: string;
}

/** Buyer-facing price breakdown. Renders only catalog data, never model text. */
export function priceBreakdown(lines: ScopeLine[], catalog: Catalog = CATALOG): PriceBreakdownRow[] {
  return lines.flatMap((line) => {
    const item = catalog.items.find((candidate) => candidate.id === line.catalogItemId);
    if (!item) return [];
    return [
      {
        catalogItemId: item.id,
        label: item.label,
        quantity: line.quantity,
        unit: item.unit,
        unitPriceMinor: item.unitPriceMinor,
        lineTotalMinor: item.unitPriceMinor * line.quantity,
        deliverable: item.deliverableTemplate
      }
    ];
  });
}

export function formatMinor(amountMinor: number, currency: string): string {
  const sign = amountMinor < 0 ? '-' : '';
  const value = Math.abs(amountMinor);
  const whole = Math.floor(value / 100);
  const cents = String(value % 100).padStart(2, '0');
  return `${sign}${whole}.${cents} ${currency}`;
}

/** Catalog item IDs are the only values the AI is allowed to name. */
export function catalogItemIds(catalog: Catalog = CATALOG): string[] {
  return catalog.items.map((item) => item.id);
}

export { findCatalogItem };
