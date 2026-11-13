import fs from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';
import express, { type Request, type Response } from 'express';
import { createServer as createViteServer } from 'vite';
import { getDatabase, persistDatabase } from './src/server/db.js';
import { hashPassword } from './src/server/seedSupermarket.js';
import type {
  CartItem,
  OrderItemSnapshot,
  OrderStatus,
  SupermarketOrder,
  SupermarketProduct,
} from './src/types/supermarket.js';

dotenv.config();

const PORT = Number(process.env.PORT || 3000);
const UPLOADS_DIR = path.resolve(process.cwd(), 'data/uploads');

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  const storeImagesDir = path.resolve(process.cwd(), 'src/assets/images');
  app.use('/store-images', express.static(storeImagesDir));
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
  app.use('/uploads', express.static(UPLOADS_DIR));

  app.get('/api/health', async (_req: Request, res: Response) => {
    const db = await getDatabase();
    res.json({
      ok: true,
      store: 'RAVI SUPERMARKET',
      productsCount: db.products.length,
      categoriesCount: db.categories.length,
    });
  });

  // Bootstrap store state (categories, coupons, featured unique items)
  app.get('/api/store/bootstrap', async (_req: Request, res: Response) => {
    const db = await getDatabase();
    res.json({
      categories: db.categories,
      products: db.products,
      coupons: db.coupons.filter((c) => c.active),
      allCoupons: db.coupons,
    });
  });

  // Product query with filtering & sorting
  app.get('/api/products', async (req: Request, res: Response) => {
    const db = await getDatabase();
    const category = String(req.query.category || '').trim();
    const search = String(req.query.search || '').trim().toLowerCase();
    const sort = String(req.query.sort || 'popular');

    let items = [...db.products];
    if (category && category !== 'All') {
      items = items.filter((p) => p.category === category);
    }
    if (search) {
      items = items.filter(
        (p) =>
          p.name.toLowerCase().includes(search) ||
          p.brand.toLowerCase().includes(search) ||
          p.category.toLowerCase().includes(search) ||
          p.subcategory.toLowerCase().includes(search)
      );
    }

    if (sort === 'price-asc') items.sort((a, b) => a.price - b.price);
    else if (sort === 'price-desc') items.sort((a, b) => b.price - a.price);
    else if (sort === 'rating') items.sort((a, b) => b.rating - a.rating);
    else if (sort === 'discount') items.sort((a, b) => b.discountPercent - a.discountPercent);
    else items.sort((a, b) => b.popularity - a.popularity);

    res.json({ products: items, total: items.length });
  });

  app.get('/api/products/:id', async (req: Request, res: Response) => {
    const db = await getDatabase();
    const product = db.products.find(
      (p) => p.id === req.params.id || p.slug === req.params.id
    );
    if (!product) {
      res.status(404).json({ error: 'Product not found.' });
      return;
    }
    res.json({ product });
  });

  // Admin: create / update / delete unique product
  app.post('/api/products', async (req: Request, res: Response) => {
    const db = await getDatabase();
    const body = req.body as Partial<SupermarketProduct>;
    const name = String(body.name || '').trim();
    const price = Number(body.price || 0);
    const originalPrice = Number(body.originalPrice || price || 0);
    const image = String(body.image || '').trim();

    if (!name || price <= 0 || !image) {
      res.status(400).json({ error: 'Product name, positive price, and unique image are required.' });
      return;
    }

    if (db.products.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      res.status(409).json({ error: 'A product with this exact name already exists.' });
      return;
    }

    const discountPercent =
      originalPrice > price ? Math.round(((originalPrice - price) / originalPrice) * 100) : 0;
    const category = body.category || 'Groceries & Staples';

    const newProduct: SupermarketProduct = {
      id: `prod-custom-${Date.now()}`,
      sku: `RSM-CUS-${Math.floor(100 + Math.random() * 899)}`,
      name,
      slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
      category,
      subcategory: String(body.subcategory || 'Curated Selection'),
      brand: String(body.brand || 'Ravi Select'),
      weight: String(body.weight || '500 g'),
      price,
      originalPrice: originalPrice || price,
      discountPercent,
      offerLabel: discountPercent > 0 ? `Save ${discountPercent}%` : 'New Selection',
      description: String(
        body.description || `${name} freshly stocked at RAVI SUPERMARKET.`
      ),
      specifications: {
        Brand: String(body.brand || 'Ravi Select'),
        Department: category,
        'Pack Size': String(body.weight || '500 g'),
        'GST Rate': `${Number(body.gstPercent ?? 5)}%`,
      },
      image,
      stock: Number(body.stock ?? 30),
      popularity: 85,
      rating: 4.8,
      reviewCount: 1,
      reviews: [],
      isTodayDeal: Boolean(body.isTodayDeal),
      isBestSeller: Boolean(body.isBestSeller),
      isTrending: Boolean(body.isTrending ?? true),
      isNewArrival: true,
      isDailyEssential: Boolean(body.isDailyEssential),
      isRecommended: Boolean(body.isRecommended),
      gstPercent: Number(body.gstPercent ?? 5),
      createdAt: new Date().toISOString(),
    };

    db.products.unshift(newProduct);
    const cat = db.categories.find((c) => c.name === category);
    if (cat) cat.productCount += 1;

    await persistDatabase(db);
    res.status(201).json({ product: newProduct });
  });

  app.delete('/api/products/:id', async (req: Request, res: Response) => {
    const db = await getDatabase();
    const idx = db.products.findIndex((p) => p.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Product not found.' });
      return;
    }
    const [removed] = db.products.splice(idx, 1);
    const cat = db.categories.find((c) => c.name === removed.category);
    if (cat && cat.productCount > 0) cat.productCount -= 1;
    await persistDatabase(db);
    res.json({ ok: true });
  });

  // Upload image for custom product in admin
  app.post('/api/upload', async (req: Request, res: Response) => {
    try {
      const dataUrl = String(req.body?.dataUrl || '');
      const match = dataUrl.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/);
      if (!match) {
        res.status(400).json({ error: 'Invalid image payload.' });
        return;
      }
      const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
      const filename = `custom_${Date.now()}_${Math.floor(Math.random() * 1000)}.${ext}`;
      await fs.writeFile(path.join(UPLOADS_DIR, filename), Buffer.from(match[2], 'base64'));
      res.json({ url: `/uploads/${filename}` });
    } catch {
      res.status(500).json({ error: 'Upload failed.' });
    }
  });

  // Product review submission
  app.post('/api/products/:id/reviews', async (req: Request, res: Response) => {
    const db = await getDatabase();
    const product = db.products.find((p) => p.id === req.params.id);
    if (!product) {
      res.status(404).json({ error: 'Product not found.' });
      return;
    }
    const userName = String(req.body?.userName || 'Verified Shopper').trim();
    const rating = Math.min(5, Math.max(1, Number(req.body?.rating || 5)));
    const title = String(req.body?.title || 'Fresh Quality').trim();
    const comment = String(req.body?.comment || '').trim();
    if (!comment) {
      res.status(400).json({ error: 'Please write a short review.' });
      return;
    }

    const review = {
      id: `rev-${Date.now()}`,
      userName,
      rating,
      title,
      comment,
      verifiedPurchase: true,
      createdAt: new Date().toISOString(),
    };
    product.reviews.unshift(review);
    product.reviewCount += 1;
    product.rating = Number(
      ((product.rating * 4 + rating) / 5).toFixed(1)
    );
    await persistDatabase(db);
    res.status(201).json({ product });
  });

  // Auth: login / register
  app.post('/api/auth/login', async (req: Request, res: Response) => {
    const db = await getDatabase();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const user = db.users.find(
      (u) => u.email.toLowerCase() === email && u.passwordHash === hashPassword(password)
    );
    if (!user) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }
    const { passwordHash: _ph, ...safeUser } = user;
    res.json({ user: safeUser });
  });

  app.post('/api/auth/register', async (req: Request, res: Response) => {
    const db = await getDatabase();
    const name = String(req.body?.name || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const phone = String(req.body?.phone || '').trim();
    const password = String(req.body?.password || '');

    if (!name || !email.includes('@') || password.length < 4) {
      res.status(400).json({ error: 'Provide name, valid email, and a password (min 4 chars).' });
      return;
    }
    if (db.users.some((u) => u.email.toLowerCase() === email)) {
      res.status(409).json({ error: 'An account with this email already exists.' });
      return;
    }

    const newUser = {
      id: `usr-${Date.now()}`,
      name,
      email,
      phone: phone || '+91 98400 00000',
      passwordHash: hashPassword(password),
      role: 'customer' as const,
      wishlist: [],
      addresses: [],
      createdAt: new Date().toISOString(),
    };
    db.users.push(newUser);
    await persistDatabase(db);
    const { passwordHash: _ph, ...safeUser } = newUser;
    res.status(201).json({ user: safeUser });
  });

  // Coupon validation
  app.post('/api/coupons/validate', async (req: Request, res: Response) => {
    const db = await getDatabase();
    const code = String(req.body?.code || '').trim().toUpperCase();
    const subtotal = Number(req.body?.subtotal || 0);
    const coupon = db.coupons.find((c) => c.code.toUpperCase() === code && c.active);
    if (!coupon) {
      res.status(404).json({ error: 'Coupon code not found or inactive.' });
      return;
    }
    if (subtotal < coupon.minOrder) {
      res.status(400).json({
        error: `Add ₹${coupon.minOrder - subtotal} more to unlock ${coupon.code}.`,
      });
      return;
    }
    let discount =
      coupon.discountType === 'percent'
        ? Math.round((subtotal * coupon.discountValue) / 100)
        : coupon.discountValue;
    if (coupon.maxDiscount) discount = Math.min(discount, coupon.maxDiscount);
    res.json({ coupon, discount });
  });

  // Checkout / place order
  app.post('/api/orders', async (req: Request, res: Response) => {
    const db = await getDatabase();
    const {
      userId,
      customerName,
      customerEmail,
      customerPhone,
      address,
      deliverySlot,
      paymentMethod,
      couponCode,
      items,
    } = req.body as {
      userId?: string;
      customerName: string;
      customerEmail: string;
      customerPhone: string;
      address: SupermarketOrder['address'];
      deliverySlot: string;
      paymentMethod: SupermarketOrder['paymentMethod'];
      couponCode?: string;
      items: CartItem[];
    };

    if (!customerName || !customerPhone || !address?.line1 || !Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: 'Please complete delivery contact details and cart items.' });
      return;
    }

    const snapshots: OrderItemSnapshot[] = [];
    let subtotal = 0;
    let gstAmount = 0;

    for (const entry of items) {
      const product = db.products.find((p) => p.id === entry.productId);
      if (!product) continue;
      const qty = Math.max(1, Math.round(entry.quantity || 1));
      const lineTotal = product.price * qty;
      subtotal += lineTotal;
      gstAmount += Math.round((lineTotal * product.gstPercent) / 100);
      if (product.stock >= qty) product.stock -= qty;
      snapshots.push({
        productId: product.id,
        sku: product.sku,
        name: product.name,
        category: product.category,
        brand: product.brand,
        weight: product.weight,
        image: product.image,
        unitPrice: product.price,
        quantity: qty,
        gstPercent: product.gstPercent,
        lineTotal,
      });
    }

    if (snapshots.length === 0) {
      res.status(400).json({ error: 'No valid products found in order.' });
      return;
    }

    let couponDiscount = 0;
    let appliedCode: string | undefined;
    if (couponCode) {
      const coupon = db.coupons.find(
        (c) => c.code.toUpperCase() === couponCode.trim().toUpperCase() && c.active
      );
      if (coupon && subtotal >= coupon.minOrder) {
        appliedCode = coupon.code;
        couponDiscount =
          coupon.discountType === 'percent'
            ? Math.round((subtotal * coupon.discountValue) / 100)
            : coupon.discountValue;
        if (coupon.maxDiscount) couponDiscount = Math.min(couponDiscount, coupon.maxDiscount);
      }
    }

    const deliveryFee = subtotal >= 499 ? 0 : 39;
    const totalAmount = Math.max(0, subtotal - couponDiscount + gstAmount + deliveryFee);
    const shortNum = Math.floor(1000 + Math.random() * 9000);

    const newOrder: SupermarketOrder = {
      id: `ord-${Date.now()}`,
      orderNumber: `RSM-2026-${shortNum}`,
      userId,
      customerName,
      customerEmail: customerEmail || 'guest@ravisupermarket.in',
      customerPhone,
      address,
      deliverySlot: deliverySlot || 'Express 45 Min Delivery',
      paymentMethod: paymentMethod || 'UPI',
      paymentStatus: paymentMethod === 'Cash on Delivery' ? 'Pending COD' : 'Paid',
      status: 'Confirmed',
      couponCode: appliedCode,
      subtotal,
      couponDiscount,
      gstAmount,
      deliveryFee,
      totalAmount,
      items: snapshots,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    db.orders.unshift(newOrder);
    await persistDatabase(db);
    res.status(201).json({ order: newOrder });
  });

  app.get('/api/orders', async (req: Request, res: Response) => {
    const db = await getDatabase();
    const email = String(req.query.email || '').trim().toLowerCase();
    const role = String(req.query.role || 'customer');
    if (role === 'admin') {
      res.json({ orders: db.orders });
      return;
    }
    const filtered = email
      ? db.orders.filter((o) => o.customerEmail.toLowerCase() === email)
      : db.orders.slice(0, 10);
    res.json({ orders: filtered });
  });

  app.patch('/api/orders/:id/status', async (req: Request, res: Response) => {
    const db = await getDatabase();
    const order = db.orders.find((o) => o.id === req.params.id);
    if (!order) {
      res.status(404).json({ error: 'Order not found.' });
      return;
    }
    order.status = req.body.status as OrderStatus;
    order.updatedAt = new Date().toISOString();
    await persistDatabase(db);
    res.json({ order });
  });

  // Contact inquiry & newsletter
  app.post('/api/contact', async (req: Request, res: Response) => {
    const db = await getDatabase();
    const name = String(req.body?.name || '').trim();
    const email = String(req.body?.email || '').trim();
    const phone = String(req.body?.phone || '').trim();
    const topic = String(req.body?.topic || 'Order Support').trim();
    const message = String(req.body?.message || '').trim();

    if (!name || !email.includes('@') || !message) {
      res.status(400).json({ error: 'Please provide your name, valid email, and message.' });
      return;
    }

    const inquiry = {
      id: `inq-${Date.now()}`,
      referenceCode: `RSM-SUP-${Math.floor(1000 + Math.random() * 9000)}`,
      name,
      email,
      phone: phone || '+91 98400 00000',
      topic,
      message,
      createdAt: new Date().toISOString(),
    };
    db.inquiries.unshift(inquiry);
    await persistDatabase(db);
    res.status(201).json({ inquiry });
  });

  app.post('/api/newsletter', async (req: Request, res: Response) => {
    const db = await getDatabase();
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!email.includes('@')) {
      res.status(400).json({ error: 'Please enter a valid email address.' });
      return;
    }
    if (!db.newsletter.includes(email)) {
      db.newsletter.push(email);
      await persistDatabase(db);
    }
    res.json({ ok: true, email });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`RAVI SUPERMARKET server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start RAVI SUPERMARKET server:', err);
  process.exit(1);
});
