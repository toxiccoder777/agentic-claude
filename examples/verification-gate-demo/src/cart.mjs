export function subtotal(items) {
  return items.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

export function applyDiscount(amount, percent) {
  if (percent < 0 || percent > 100) throw new RangeError('percent must be 0-100');
  return amount - (amount * percent) / 100;
}

export function withTax(amount, rate) {
  return Math.round(amount * (1 + rate) * 100) / 100;
}

export function total(items, { discountPercent = 0, taxRate = 0 } = {}) {
  return withTax(applyDiscount(subtotal(items), discountPercent), taxRate);
}
