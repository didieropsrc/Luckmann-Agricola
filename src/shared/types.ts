export interface Category {
  id: number;
  parent_id: number | null;
  name: string;
  slug: string;
  description: string;
  position: number;
}

export interface ProductImage {
  id: number;
  url: string;
  alt: string;
  position: number;
}

export interface Product {
  id: number;
  name: string;
  slug: string;
  short_description: string;
  description: string;
  price: number;
  stock: number;
  active: boolean;
  featured: boolean;
  seo_title: string;
  seo_description: string;
  category_ids: number[];
  images: ProductImage[];
}

export interface Catalog {
  categories: Category[];
  products: Product[];
}

export interface SiteConfig {
  siteUrl: string;
  whatsapp: string;
}

export interface Suggestion {
  id: number;
  name: string;
  contact: string;
  message: string;
  status: string;
  created_at: string;
}
