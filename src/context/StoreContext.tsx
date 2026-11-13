import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type {
  ActiveRoute,
  CartItem,
  CouponItem,
  CustomerAddress,
  DepartmentName,
  SupermarketCategory,
  SupermarketOrder,
  SupermarketProduct,
  SupermarketUser,
} from '../types/supermarket';

interface ToastNotice {
  id: string;
  title: string;
  detail?: string;
}

interface StoreContextValue {
  route: ActiveRoute;
  selectedCategory: DepartmentName | 'All';
  selectedProductId: string | null;
  searchQuery: string;
  deliverySlot: string;
  deliveryArea: string;
  darkMode: boolean;
  categories: SupermarketCategory[];
  products: SupermarketProduct[];
  coupons: CouponItem[];
  cart: CartItem[];
  wishlist: string[];
  compareIds: string[];
  user: Omit<SupermarketUser, 'passwordHash'> | null;
  orders: SupermarketOrder[];
  cartOpen: boolean;
  compareOpen: boolean;
  authOpen: boolean;
  loading: boolean;
  toasts: ToastNotice[];
  navigationTick: number;
  setRoute: (r: ActiveRoute, opts?: { category?: DepartmentName | 'All'; productId?: string }) => void;
  navigateToProduct: (productId: string) => void;
  navigateToCategory: (category: DepartmentName | 'All') => void;
  setSearchQuery: (q: string) => void;
  setDeliverySlot: (slot: string) => void;
  setDeliveryArea: (area: string) => void;
  toggleDarkMode: () => void;
  addToCart: (productId: string, qty?: number) => void;
  updateCartQty: (productId: string, qty: number) => void;
  removeFromCart: (productId: string) => void;
  clearCart: () => void;
  toggleWishlist: (productId: string) => void;
  toggleCompare: (productId: string) => void;
  setCartOpen: (open: boolean) => void;
  setCompareOpen: (open: boolean) => void;
  setAuthOpen: (open: boolean) => void;
  loginUser: (email: string, password: string) => Promise<boolean>;
  registerUser: (name: string, email: string, phone: string, password: string) => Promise<boolean>;
  logoutUser: () => void;
  refreshStore: () => Promise<void>;
  refreshOrders: () => Promise<void>;
  addOrderRecord: (order: SupermarketOrder) => void;
  updateProductInState: (updated: SupermarketProduct) => void;
  pushToast: (title: string, detail?: string) => void;
  cartCount: number;
  cartSubtotal: number;
}

const StoreContext = createContext<StoreContextValue | null>(null);

const CART_STORAGE_KEY = 'ravi_sm_cart_v2';
const WISHLIST_STORAGE_KEY = 'ravi_sm_wishlist_v2';
const THEME_STORAGE_KEY = 'ravi_sm_dark_v2';

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [route, setRouteState] = useState<ActiveRoute>('home');
  const [selectedCategory, setSelectedCategory] = useState<DepartmentName | 'All'>('All');
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [deliverySlot, setDeliverySlot] = useState('Express 45 Min Delivery');
  const [deliveryArea, setDeliveryArea] = useState('Anna Nagar · 600040');
  const [navigationTick, setNavigationTick] = useState(0);

  const [darkMode, setDarkMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem(THEME_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const [categories, setCategories] = useState<SupermarketCategory[]>([]);
  const [products, setProducts] = useState<SupermarketProduct[]>([]);
  const [coupons, setCoupons] = useState<CouponItem[]>([]);
  const [orders, setOrders] = useState<SupermarketOrder[]>([]);
  const [loading, setLoading] = useState(true);

  const [cart, setCart] = useState<CartItem[]>(() => {
    try {
      const saved = localStorage.getItem(CART_STORAGE_KEY);
      return saved ? (JSON.parse(saved) as CartItem[]) : [];
    } catch {
      return [];
    }
  });

  const [wishlist, setWishlist] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(WISHLIST_STORAGE_KEY);
      return saved ? (JSON.parse(saved) as string[]) : ['prod-basmati-rice', 'prod-alphonso-mango'];
    } catch {
      return ['prod-basmati-rice', 'prod-alphonso-mango'];
    }
  });

  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [user, setUser] = useState<Omit<SupermarketUser, 'passwordHash'> | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [toasts, setToasts] = useState<ToastNotice[]>([]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, String(darkMode));
    } catch {
      // Ignore storage failures
    }
  }, [darkMode]);

  useEffect(() => {
    try {
      localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
    } catch {
      // Ignore storage failures
    }
  }, [cart]);

  useEffect(() => {
    try {
      localStorage.setItem(WISHLIST_STORAGE_KEY, JSON.stringify(wishlist));
    } catch {
      // Ignore storage failures
    }
  }, [wishlist]);

  const pushToast = (title: string, detail?: string) => {
    const id = `toast-${Date.now()}-${Math.random()}`;
    setToasts((prev) => [...prev.slice(-2), { id, title, detail }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3200);
  };

  const refreshStore = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/store/bootstrap');
      const data = await res.json();
      setCategories(data.categories || []);
      setProducts(data.products || []);
      setCoupons(data.coupons || []);
    } finally {
      setLoading(false);
    }
  };

  const refreshOrders = async () => {
    try {
      const params = new URLSearchParams();
      if (user?.role === 'admin') params.set('role', 'admin');
      else if (user?.email) params.set('email', user.email);
      const res = await fetch(`/api/orders?${params.toString()}`);
      const data = await res.json();
      setOrders(data.orders || []);
    } catch {
      // Keep current orders if network fails
    }
  };

  useEffect(() => {
    void refreshStore();
    void refreshOrders();
  }, []);

  useEffect(() => {
    void refreshOrders();
  }, [user?.email, user?.role]);

  const setRoute = (
    nextRoute: ActiveRoute,
    opts?: { category?: DepartmentName | 'All'; productId?: string }
  ) => {
    if (opts?.category !== undefined) setSelectedCategory(opts.category);
    if (opts?.productId !== undefined) setSelectedProductId(opts.productId);
    setNavigationTick((t) => t + 1);
    setRouteState(nextRoute);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const navigateToProduct = (productId: string) => {
    setSelectedProductId(productId);
    setNavigationTick((t) => t + 1);
    setRouteState('product');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const navigateToCategory = (category: DepartmentName | 'All') => {
    setSelectedCategory(category);
    setNavigationTick((t) => t + 1);
    setRouteState('products');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const toggleDarkMode = () => setDarkMode((prev) => !prev);

  const addToCart = (productId: string, qty = 1) => {
    const target = products.find((p) => p.id === productId);
    setCart((prev) => {
      const existing = prev.find((item) => item.productId === productId);
      if (existing) {
        return prev.map((item) =>
          item.productId === productId
            ? { ...item, quantity: item.quantity + qty }
            : item
        );
      }
      return [...prev, { productId, quantity: qty }];
    });
    if (target) {
      pushToast('Added to Basket', `${target.name} × ${qty}`);
    }
  };

  const updateCartQty = (productId: string, qty: number) => {
    if (qty <= 0) {
      setCart((prev) => prev.filter((item) => item.productId !== productId));
      return;
    }
    setCart((prev) =>
      prev.map((item) => (item.productId === productId ? { ...item, quantity: qty } : item))
    );
  };

  const removeFromCart = (productId: string) => {
    setCart((prev) => prev.filter((item) => item.productId !== productId));
  };

  const clearCart = () => setCart([]);

  const toggleWishlist = (productId: string) => {
    const product = products.find((p) => p.id === productId);
    setWishlist((prev) => {
      const exists = prev.includes(productId);
      if (product) {
        pushToast(
          exists ? 'Removed from Wishlist' : 'Saved to Wishlist',
          product.name
        );
      }
      return exists ? prev.filter((id) => id !== productId) : [...prev, productId];
    });
  };

  const toggleCompare = (productId: string) => {
    setCompareIds((prev) => {
      if (prev.includes(productId)) {
        return prev.filter((id) => id !== productId);
      }
      if (prev.length >= 3) {
        pushToast('Compare Limit (3)', 'Remove an item to compare another.');
        return prev;
      }
      return [...prev, productId];
    });
  };

  const loginUser = async (email: string, password: string): Promise<boolean> => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      pushToast('Sign In Failed', data.error || 'Check credentials');
      return false;
    }
    setUser(data.user);
    setAuthOpen(false);
    pushToast(`Welcome back, ${data.user.name}`);
    return true;
  };

  const registerUser = async (
    name: string,
    email: string,
    phone: string,
    password: string
  ): Promise<boolean> => {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, phone, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      pushToast('Registration Failed', data.error || 'Please check details');
      return false;
    }
    setUser(data.user);
    setAuthOpen(false);
    pushToast('Account Created', `Signed in as ${data.user.name}`);
    return true;
  };

  const logoutUser = () => {
    setUser(null);
    pushToast('Signed Out');
    if (route === 'admin') setRoute('home');
  };

  const addOrderRecord = (order: SupermarketOrder) => {
    setOrders((prev) => [order, ...prev]);
  };

  const updateProductInState = (updated: SupermarketProduct) => {
    setProducts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
  };

  const { cartCount, cartSubtotal, hydratedCart } = useMemo(() => {
    let count = 0;
    let subtotal = 0;
    const list: CartItem[] = [];
    for (const entry of cart) {
      const product = products.find((p) => p.id === entry.productId);
      if (product) {
        count += entry.quantity;
        subtotal += product.price * entry.quantity;
        list.push({ ...entry, product });
      }
    }
    return { cartCount: count, cartSubtotal: subtotal, hydratedCart: list };
  }, [cart, products]);

  const value: StoreContextValue = {
    route,
    selectedCategory,
    selectedProductId,
    searchQuery,
    deliverySlot,
    deliveryArea,
    darkMode,
    categories,
    products,
    coupons,
    cart: hydratedCart,
    wishlist,
    compareIds,
    user,
    orders,
    cartOpen,
    compareOpen,
    authOpen,
    loading,
    toasts,
    navigationTick,
    setRoute,
    navigateToProduct,
    navigateToCategory,
    setSearchQuery,
    setDeliverySlot,
    setDeliveryArea,
    toggleDarkMode,
    addToCart,
    updateCartQty,
    removeFromCart,
    clearCart,
    toggleWishlist,
    toggleCompare,
    setCartOpen,
    setCompareOpen,
    setAuthOpen,
    loginUser,
    registerUser,
    logoutUser,
    refreshStore,
    refreshOrders,
    addOrderRecord,
    updateProductInState,
    pushToast,
    cartCount,
    cartSubtotal,
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreContextValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside StoreProvider');
  return ctx;
}
