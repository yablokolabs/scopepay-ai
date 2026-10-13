/**
 * Frozen change requests, evaluated against a scope that has already been
 * accepted: a landing page, two content pages and a contact form.
 *
 * All content is synthetic.
 */
import type { ChangeClass } from '../lib/schemas.js';

export interface ChangeFixture {
  id: string;
  kind: 'no_change' | 'clarification' | 'in_scope_adjustment' | 'new_scope_delta';
  text: string;
  expectedChangeClass: ChangeClass;
}

export const CHANGE_FIXTURES: ChangeFixture[] = [
  {
    id: 'c01-add-one-page',
    kind: 'new_scope_delta',
    text: 'Could we add one more page for our delivery information? It can use the same template as the other pages.',
    expectedChangeClass: 'new_scope_delta'
  },
  {
    id: 'c02-colour-tweak',
    kind: 'in_scope_adjustment',
    text: 'The teal in the header feels too strong. Please make it a lighter shade of the same colour, no layout changes.',
    expectedChangeClass: 'in_scope_adjustment'
  },
  {
    id: 'c03-second-language',
    kind: 'new_scope_delta',
    text: 'We also need a French version of the whole site now that we are working with a partner in Lyon.',
    expectedChangeClass: 'new_scope_delta'
  },
  {
    id: 'c04-booking-system',
    kind: 'new_scope_delta',
    text: 'Can we add an online booking system with a calendar, deposits and reminder emails before launch?',
    expectedChangeClass: 'new_scope_delta'
  },
  {
    id: 'c05-clarifying-question',
    kind: 'clarification',
    text: 'Just checking: does the agreed amount include the hosting for the first year, or do we pay that ourselves?',
    expectedChangeClass: 'clarification'
  },
  {
    id: 'c06-typo-fix',
    kind: 'no_change',
    text: 'There is a typo on the services page, "freindly" should be "friendly". Nothing else, thanks.',
    expectedChangeClass: 'no_change'
  },
  {
    id: 'c07-duplicate-page-request',
    kind: 'no_change',
    text: 'Could we add one more page for our delivery information? It can use the same template as the other pages.',
    expectedChangeClass: 'no_change'
  },
  {
    id: 'c08-haggle-price',
    kind: 'clarification',
    text: 'The total feels a bit high for what is a simple site. Can you drop the price by 30 percent, or take the editing pass out and charge less?',
    expectedChangeClass: 'clarification'
  },
  {
    id: 'c09-add-copy-pass',
    kind: 'new_scope_delta',
    text: 'We would like our draft copy edited properly for tone and spelling across all pages, on top of what we agreed.',
    expectedChangeClass: 'new_scope_delta'
  },
  {
    id: 'c10-add-stock-photos',
    kind: 'new_scope_delta',
    text: 'We do not have usable photos after all. Can you source stock photography and licence it for us, and resize whatever you choose?',
    expectedChangeClass: 'new_scope_delta'
  }
];
