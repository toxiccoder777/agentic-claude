#!/usr/bin/env node
// Minimal dependency-free TAP runner. DEMO_FAULT injects the failure modes the
// gate is supposed to catch, so the demo can prove each guard without anyone
// hand-editing source.
import { subtotal, applyDiscount, withTax, total } from '../src/cart.mjs';

const fault = process.env.DEMO_FAULT ?? 'none';

const items = [
  { price: 10, quantity: 2 },
  { price: 5.5, quantity: 4 },
];

const cases = [
  ['subtotal sums price times quantity', () => subtotal(items) === 42],
  ['subtotal of an empty cart is zero', () => subtotal([]) === 0],
  ['applyDiscount takes a percentage off', () => applyDiscount(200, 10) === 180],
  ['applyDiscount rejects an out-of-range percent', () => {
    try {
      applyDiscount(100, 150);
      return false;
    } catch (err) {
      return err instanceof RangeError;
    }
  }],
  ['withTax rounds to two decimal places', () => withTax(19.999, 0) === 20],
  ['total composes discount and tax', () => total(items, { discountPercent: 50, taxRate: 0.1 }) === 23.1],
  ['known-flaky pricing probe', () => fault !== 'flaky' || Math.random() > 0.5],
];

if (fault === 'silence') {
  // Stands in for a runner that died before emitting anything — a crashed
  // browser, a missing binary, an OOM kill.
  process.exit(0);
}

const emitted = fault === 'truncated' ? cases.slice(0, 3) : cases;

console.log('TAP version 13');
console.log(`1..${cases.length}`);

emitted.forEach((entry, index) => {
  const [name, assertion] = entry;
  let ok;
  try {
    ok = assertion() === true;
  } catch {
    ok = false;
  }
  if (fault === 'regression' && name === 'total composes discount and tax') ok = false;
  console.log(`${ok ? 'ok' : 'not ok'} ${index + 1} - ${name}`);
});
