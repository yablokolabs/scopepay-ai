/**
 * The single fixed-price design catalog for this sandbox build.
 *
 * Prices are merchant-authored integers in cents. The AI never proposes or
 * adjusts a price; it only selects catalog item IDs and quantities, and the
 * server recomputes the total from this table.
 */
import type { Catalog } from './schemas.js';

export const CATALOG_VERSION = 'catalog-2026-10-13';

export const CATALOG: Catalog = {
  version: CATALOG_VERSION,
  merchantId: process.env.MERCHANT_ID || 'sandbox-merchant-1',
  merchantName: process.env.MERCHANT_NAME || 'Ashgrove Design Studio (sandbox merchant)',
  currency: 'USD',
  taxIncluded: false,
  shippingIncluded: true,
  items: [
    {
      id: 'landing-page',
      label: 'Single responsive landing page',
      unitPriceMinor: 45000,
      minQty: 1,
      maxQty: 6,
      unit: 'page',
      deliverableTemplate: 'One responsive page built from an approved layout, mobile and desktop breakpoints.',
      description: 'Layout, styling and copy placement for one page. Copy is supplied by the client.'
    },
    {
      id: 'content-page',
      label: 'Additional content page',
      unitPriceMinor: 18000,
      minQty: 1,
      maxQty: 12,
      unit: 'page',
      deliverableTemplate: 'One additional responsive content page sharing the approved page template.',
      description: 'Uses the template established by the landing page.'
    },
    {
      id: 'copy-editing',
      label: 'Copy editing pass',
      unitPriceMinor: 12000,
      minQty: 1,
      maxQty: 4,
      unit: 'pass',
      deliverableTemplate: 'One editing pass over client-supplied copy: clarity, tone and spelling.',
      description: 'Editorial only. Does not include writing new copy from scratch.'
    },
    {
      id: 'brand-wordmark',
      label: 'Wordmark and type system',
      unitPriceMinor: 60000,
      minQty: 1,
      maxQty: 1,
      unit: 'system',
      deliverableTemplate: 'One wordmark plus a two-font type scale with usage rules.',
      description: 'Logo mark only; no full brand guideline document.'
    },
    {
      id: 'contact-form',
      label: 'Contact form with email delivery',
      unitPriceMinor: 22000,
      minQty: 1,
      maxQty: 1,
      unit: 'form',
      deliverableTemplate: 'One contact form wired to an email endpoint with basic spam protection.',
      description: 'No CRM, marketing automation or custom workflow.'
    },
    {
      id: 'image-optimisation',
      label: 'Image optimisation pass',
      unitPriceMinor: 9000,
      minQty: 1,
      maxQty: 4,
      unit: 'pass',
      deliverableTemplate: 'One pass resizing and compressing up to 30 supplied images.',
      description: 'Client must hold rights to the supplied images.'
    },
    {
      id: 'basic-seo',
      label: 'Basic on-page SEO setup',
      unitPriceMinor: 15000,
      minQty: 1,
      maxQty: 1,
      unit: 'setup',
      deliverableTemplate: 'Titles, meta descriptions, sitemap and one analytics snippet.',
      description: 'On-page only. No link building, audits or paid keyword research.'
    },
    {
      id: 'deployment-handover',
      label: 'Deployment and handover session',
      unitPriceMinor: 20000,
      minQty: 1,
      maxQty: 1,
      unit: 'session',
      deliverableTemplate: 'One 60-minute handover session plus deployment to the client account.',
      description: 'Hosting and domain costs are paid by the client directly.'
    }
  ]
};

/** Catalog rules a merchant would state out loud; surfaced to the buyer as exclusions. */
export const STANDARD_EXCLUSIONS: string[] = [
  'Copywriting from scratch is not included; the client supplies copy or buys the copy editing pass.',
  'Stock photography, illustration and font licensing fees are not included.',
  'Hosting, domain registration and third-party subscription costs are not included.',
  'No tax or shipping is charged in this fixed-price service catalog; the listed total is the full amount.',
  'Search engine marketing, paid advertising and social media management are not included.',
  'E-commerce checkout, payment processing, membership and booking systems are outside this catalog.'
];

export function findCatalogItem(id: string) {
  return CATALOG.items.find((item) => item.id === id);
}
