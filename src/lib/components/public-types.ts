export type PublicComponentMediaKind = "image" | "video" | "missing";

export interface PublicComponentCard {
  id: string;
  title: string;
  category: string;
  thumbnail_path: string | null;
  created_at: string;
  thumbnail_url: string | null;
  media_kind: PublicComponentMediaKind;
}

export interface PublicComponentsQuery {
  page: number;
  limit: number;
  query: string;
  category: string | null;
}

export interface PublicComponentsResult {
  components: PublicComponentCard[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  query: string;
  category: string | null;
  categories: string[];
}
