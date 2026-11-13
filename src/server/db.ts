import fs from 'node:fs/promises';
import path from 'node:path';
import type { StoreDatabase } from '../types/supermarket.js';
import {
  buildInitialDatabase,
  CATALOG_VERSION,
  SUPERMARKET_CATEGORIES,
} from './seedSupermarket.js';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'ravi-supermarket.json');

let memoryCache: StoreDatabase | null = null;
let writeQueue: Promise<void> = Promise.resolve();

function sanitizeDatabase(parsed: Partial<StoreDatabase>): StoreDatabase {
  if (parsed.catalogVersion !== CATALOG_VERSION || !Array.isArray(parsed.products)) {
    return buildInitialDatabase();
  }

  // Recompute category counts based on live unique products
  const categoryCounts = new Map<string, number>();
  for (const product of parsed.products) {
    categoryCounts.set(product.category, (categoryCounts.get(product.category) || 0) + 1);
  }

  const fresh = buildInitialDatabase();
  return {
    catalogVersion: CATALOG_VERSION,
    categories: SUPERMARKET_CATEGORIES.map((cat) => ({
      ...cat,
      productCount: categoryCounts.get(cat.name) ?? 0,
    })),
    products: parsed.products,
    users: Array.isArray(parsed.users) && parsed.users.length > 0 ? parsed.users : fresh.users,
    carts: parsed.carts && typeof parsed.carts === 'object' ? parsed.carts : {},
    orders: Array.isArray(parsed.orders) ? parsed.orders : fresh.orders,
    coupons: Array.isArray(parsed.coupons) && parsed.coupons.length > 0 ? parsed.coupons : fresh.coupons,
    newsletter: Array.isArray(parsed.newsletter) ? parsed.newsletter : [],
    inquiries: Array.isArray(parsed.inquiries) ? parsed.inquiries : [],
  };
}

export async function getDatabase(): Promise<StoreDatabase> {
  if (memoryCache) return memoryCache;

  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    const raw = await fs.readFile(DB_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<StoreDatabase>;
    const sanitized = sanitizeDatabase(parsed);
    memoryCache = sanitized;
    if (parsed.catalogVersion !== CATALOG_VERSION) {
      await persistDatabase(sanitized);
    }
    return sanitized;
  } catch {
    const fresh = buildInitialDatabase();
    memoryCache = fresh;
    await persistDatabase(fresh);
    return fresh;
  }
}

export async function persistDatabase(db: StoreDatabase): Promise<void> {
  memoryCache = db;
  writeQueue = writeQueue.then(async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(DB_FILE, JSON.stringify(db, null, 2), 'utf-8');
  });
  await writeQueue;
}
