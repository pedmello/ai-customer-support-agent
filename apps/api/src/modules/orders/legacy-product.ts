import catalog from '../customers/demo-catalog.data.json' with { type: 'json' };
import type { OrderRecord } from './order.repository.js';

// Product 1 is retained only to present historical orders, never for new registrations.
// Metadata verified against https://fakestoreapi.com/products/1 on 2026-10-20.
const historicalBackpack = {
  productId: 1,
  title: 'Fjallraven - Foldsack No. 1 Backpack, Fits 15 Laptops',
  description: 'Your perfect pack for everyday use and walks in the forest. Stash your laptop (up to 15 inches) in the padded sleeve, your everyday',
  category: "men's clothing",
  imageUrl: 'https://fakestoreapi.com/img/81fPKd-2AYL._AC_SL1500_t.png',
};

/** Enrich the original generic demo label at read time, without mutating its snapshot or prices. */
export function presentOrderItem(item: OrderRecord['items'][number]) {
  const { productId, title, imageUrl, catalogVersion, description, category, quantity, unitPriceCents } = item;
  const legacy = !catalogVersion && /^Item demonstrativo \d+$/i.test(title);
  const metadata = legacy
    ? [historicalBackpack, ...catalog].find(product => product.productId === productId)
    : undefined;
  return {
    productId,
    title: metadata?.title ?? title,
    imageUrl: imageUrl ?? metadata?.imageUrl ?? null,
    catalogVersion,
    description: description ?? metadata?.description ?? null,
    category: category ?? metadata?.category ?? null,
    quantity,
    unitPriceCents,
  };
}
