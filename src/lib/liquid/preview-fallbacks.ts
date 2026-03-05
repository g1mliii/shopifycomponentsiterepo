import type {
  LiquidEditorState,
  LiquidSchema,
  LiquidSchemaSetting,
  LiquidSettingJsonValue,
} from "./schema-types";

const SAMPLE_VIDEO_URL = "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4";
const DEFAULT_RESOURCE_LIST_SIZE = 3;
const DEFAULT_COLLECTION_PRODUCT_COUNT = 6;
const MAX_PREVIEW_FALLBACK_CACHE_ENTRIES = 300;

const RESOURCE_PREFIX_BY_TYPE: Record<string, string> = {
  article: "articles",
  blog: "blogs",
  collection: "collections",
  page: "pages",
  product: "products",
};

const imagePlaceholderCache = new Map<string, string>();
const sampleProductsCache = new Map<string, LiquidSettingJsonValue[]>();
const blockDefinitionLookupCache = new WeakMap<LiquidSchema, Map<string, LiquidSchema["blocks"][number]>>();

function setBoundedCacheEntry<T>(cache: Map<string, T>, key: string, value: T): void {
  cache.delete(key);
  cache.set(key, value);

  while (cache.size > MAX_PREVIEW_FALLBACK_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value as string | undefined;
    if (!oldestKey) {
      break;
    }
    cache.delete(oldestKey);
  }
}

function getBlockDefinitionLookup(
  schema: LiquidSchema,
): Map<string, LiquidSchema["blocks"][number]> {
  const cached = blockDefinitionLookupCache.get(schema);
  if (cached) {
    return cached;
  }

  const lookup = new Map<string, LiquidSchema["blocks"][number]>();
  for (const definition of schema.blocks) {
    lookup.set(definition.type, definition);
  }
  blockDefinitionLookupCache.set(schema, lookup);
  return lookup;
}

function isRecord(value: LiquidSettingJsonValue): value is Record<string, LiquidSettingJsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBlankString(value: LiquidSettingJsonValue): boolean {
  return typeof value !== "string" || value.trim().length === 0;
}

function toNonEmptyString(value: LiquidSettingJsonValue): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeSlug(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized.length > 0 ? normalized : "sample";
}

function toTitleCaseSlug(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function hashSeed(seed: string): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = ((hash << 5) - hash + seed.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

function createImagePlaceholder(seed: string, width = 1200, height = 800): string {
  const cacheKey = `${seed}::${width}x${height}`;
  const cached = imagePlaceholderCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const palettes = [
    { bg: "#fdf2f8", fg: "#9d174d" },
    { bg: "#eff6ff", fg: "#1d4ed8" },
    { bg: "#f0fdf4", fg: "#166534" },
    { bg: "#fffbeb", fg: "#b45309" },
    { bg: "#f5f3ff", fg: "#5b21b6" },
    { bg: "#ecfeff", fg: "#155e75" },
  ];
  const palette = palettes[hashSeed(seed) % palettes.length];
  const label = toTitleCaseSlug(seed).slice(0, 28) || "Preview";
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${height}' viewBox='0 0 ${width} ${height}'><rect width='100%' height='100%' fill='${palette.bg}'/><text x='50%' y='50%' text-anchor='middle' dominant-baseline='middle' fill='${palette.fg}' font-family='Arial, sans-serif' font-size='${Math.max(18, Math.floor(width / 18))}' font-weight='700'>${label}</text></svg>`;
  const placeholder = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
  setBoundedCacheEntry(imagePlaceholderCache, cacheKey, placeholder);
  return placeholder;
}

function normalizeResourceHandle(
  settingType: string,
  rawValue: string | null,
  seed: string,
): string {
  const prefix = RESOURCE_PREFIX_BY_TYPE[settingType] ?? "resources";
  const defaultHandle = `${prefix}/${normalizeSlug(seed)}`;

  const rawHandle = rawValue;
  if (!rawHandle) {
    return defaultHandle;
  }

  if (rawHandle.includes("/")) {
    return rawHandle;
  }

  return `${prefix}/${normalizeSlug(rawHandle)}`;
}

function getResourceTitleFromHandle(handle: string, fallbackSeed: string): string {
  const tail = handle.split("/").pop() ?? fallbackSeed;
  return toTitleCaseSlug(tail);
}

function getResourceUrlFromHandle(handle: string): string {
  if (handle.startsWith("/")) {
    return handle;
  }

  return `/${handle}`;
}

function getProductPriceFromValue(value: LiquidSettingJsonValue, index: number): number {
  if (isRecord(value) && typeof value.price === "number" && Number.isFinite(value.price)) {
    return value.price;
  }

  return 2499 + (index * 300);
}

function buildSampleProduct(seed: string, index: number): Record<string, LiquidSettingJsonValue> {
  const handle = `products/${normalizeSlug(`${seed}-${index + 1}`)}`;
  return {
    handle,
    title: `${getResourceTitleFromHandle(handle, seed)} ${index + 1}`,
    url: getResourceUrlFromHandle(handle),
    price: getProductPriceFromValue(null, index),
    featured_image: createImagePlaceholder(`${seed}-product-${index + 1}`, 800, 800),
  };
}

function buildSampleProducts(seed: string, count = DEFAULT_COLLECTION_PRODUCT_COUNT): LiquidSettingJsonValue[] {
  const cacheKey = `${seed}::${count}`;
  const cached = sampleProductsCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const products = Array.from({ length: count }, (_entry, index) => buildSampleProduct(seed, index));
  setBoundedCacheEntry(sampleProductsCache, cacheKey, products);
  return products;
}

function getRecordStringField(record: Record<string, LiquidSettingJsonValue>, key: string): string | null {
  return toNonEmptyString(record[key]);
}

function toProductObject(
  value: LiquidSettingJsonValue,
  settingType: string,
  seed: string,
  index = 0,
): Record<string, LiquidSettingJsonValue> {
  const record = isRecord(value) ? value : null;
  const rawHandle = record ? getRecordStringField(record, "handle") : toNonEmptyString(value);
  const handle = normalizeResourceHandle(settingType, rawHandle, seed);
  const title = record
    ? getRecordStringField(record, "title") ?? getResourceTitleFromHandle(handle, seed)
    : getResourceTitleFromHandle(handle, seed);
  const url = record
    ? getRecordStringField(record, "url") ?? getResourceUrlFromHandle(handle)
    : getResourceUrlFromHandle(handle);
  const featuredImage = record
    ? getRecordStringField(record, "featured_image") ?? createImagePlaceholder(`${seed}-product-image`, 800, 800)
    : createImagePlaceholder(`${seed}-product-image`, 800, 800);
  const price = getProductPriceFromValue(value, index);

  if (
    record
    && record.handle === handle
    && record.title === title
    && record.url === url
    && record.featured_image === featuredImage
    && record.price === price
  ) {
    return record;
  }

  return {
    ...(record ?? {}),
    handle,
    title,
    url,
    featured_image: featuredImage,
    price,
  };
}

function toCollectionObject(
  value: LiquidSettingJsonValue,
  seed: string,
): Record<string, LiquidSettingJsonValue> {
  const record = isRecord(value) ? value : null;
  const rawHandle = record ? getRecordStringField(record, "handle") : toNonEmptyString(value);
  const handle = normalizeResourceHandle("collection", rawHandle, seed);
  const title = record
    ? getRecordStringField(record, "title") ?? getResourceTitleFromHandle(handle, seed)
    : getResourceTitleFromHandle(handle, seed);
  const url = record
    ? getRecordStringField(record, "url") ?? getResourceUrlFromHandle(handle)
    : getResourceUrlFromHandle(handle);

  const currentProducts = record && Array.isArray(record.products)
    ? record.products
    : [];

  let products = currentProducts;
  if (currentProducts.length === 0) {
    products = buildSampleProducts(seed);
  } else {
    let nextProducts: LiquidSettingJsonValue[] | null = null;
    for (const [index, product] of currentProducts.entries()) {
      const normalized = toProductObject(product, "product", `${seed}-product`, index);
      if (nextProducts) {
        nextProducts.push(normalized);
        continue;
      }

      if (normalized !== product) {
        nextProducts = [...currentProducts.slice(0, index), normalized];
      }
    }
    if (nextProducts) {
      products = nextProducts;
    }
  }

  if (
    record
    && record.handle === handle
    && record.title === title
    && record.url === url
    && record.products === products
  ) {
    return record;
  }

  return {
    ...(record ?? {}),
    handle,
    title,
    url,
    products,
  };
}

function toGenericResourceObject(
  value: LiquidSettingJsonValue,
  settingType: string,
  seed: string,
): Record<string, LiquidSettingJsonValue> {
  const record = isRecord(value) ? value : null;
  const rawHandle = record ? getRecordStringField(record, "handle") : toNonEmptyString(value);
  const handle = normalizeResourceHandle(settingType, rawHandle, seed);
  const title = record
    ? getRecordStringField(record, "title") ?? getResourceTitleFromHandle(handle, seed)
    : getResourceTitleFromHandle(handle, seed);
  const url = record
    ? getRecordStringField(record, "url") ?? getResourceUrlFromHandle(handle)
    : getResourceUrlFromHandle(handle);

  if (record && record.handle === handle && record.title === title && record.url === url) {
    return record;
  }

  return {
    ...(record ?? {}),
    handle,
    title,
    url,
  };
}

function ensureResourceList(
  value: LiquidSettingJsonValue,
  prefix: string,
  seed: string,
): LiquidSettingJsonValue[] {
  if (Array.isArray(value) && value.length > 0) {
    let nextList: LiquidSettingJsonValue[] | null = null;
    for (const [index, entry] of value.entries()) {
      const asString = toNonEmptyString(entry);
      let normalized = `${prefix}/${normalizeSlug(`${seed}-${index + 1}`)}`;
      if (asString) {
        normalized = asString.includes("/") ? asString : `${prefix}/${normalizeSlug(asString)}`;
      }

      if (nextList) {
        nextList.push(normalized);
        continue;
      }

      if (!Object.is(entry, normalized)) {
        nextList = [...value.slice(0, index), normalized];
      }
    }

    return nextList ?? value;
  }

  return Array.from(
    { length: DEFAULT_RESOURCE_LIST_SIZE },
    (_entry, index) => `${prefix}/${normalizeSlug(`${seed}-${index + 1}`)}`,
  );
}

function toMetaobjectValue(value: LiquidSettingJsonValue, seed: string): Record<string, LiquidSettingJsonValue> {
  const fallbackType = "custom.sample";
  const fallbackHandle = normalizeSlug(seed);

  const record = isRecord(value) ? value : null;
  const currentType = record ? toNonEmptyString(record.type) : null;
  const currentHandle = record ? toNonEmptyString(record.handle) : null;
  const currentId = record ? toNonEmptyString(record.id) : null;
  const nextType = currentType ?? fallbackType;
  const nextHandle = currentHandle ?? fallbackHandle;
  const nextId = currentId ?? `gid://shopify/Metaobject/${hashSeed(seed) % 10000}`;

  if (record && record.type === nextType && record.handle === nextHandle && record.id === nextId) {
    return record;
  }

  return {
    ...(record ?? {}),
    type: nextType,
    handle: nextHandle,
    id: nextId,
  };
}

function toMenuValue(value: LiquidSettingJsonValue, seed: string): Record<string, LiquidSettingJsonValue> {
  const record = isRecord(value) ? value : null;
  const handle = record ? toNonEmptyString(record.handle) ?? `menu-${normalizeSlug(seed)}` : `menu-${normalizeSlug(seed)}`;
  const rawLinks = record && Array.isArray(record.links) ? record.links : [];
  const links = rawLinks.length > 0 ? rawLinks : ["Shop", "About", "Support"];

  if (record && record.handle === handle && record.links === links) {
    return record;
  }

  return {
    ...(record ?? {}),
    handle,
    links,
  };
}

function toFontPickerValue(value: LiquidSettingJsonValue, seed: string): LiquidSettingJsonValue {
  if (isRecord(value)) {
    if (toNonEmptyString(value.family)) {
      return value;
    }

    const defaultFamily = toTitleCaseSlug(seed).replace(/\s+/g, " ").trim() || "System";
    return {
      ...value,
      family: defaultFamily,
      fallback_families: "sans-serif",
      style: "normal",
      weight: "400",
    };
  }

  const token = toNonEmptyString(value) ?? normalizeSlug(seed);
  const familyName = toTitleCaseSlug(token.replace(/_[nib0-9]+$/i, ""));

  return {
    family: familyName || "System",
    fallback_families: "sans-serif",
    style: "normal",
    weight: "400",
  };
}

function applySettingFallback(
  setting: LiquidSchemaSetting,
  value: LiquidSettingJsonValue,
  seed: string,
): LiquidSettingJsonValue {
  const type = setting.type.toLowerCase();

  if (type === "image_picker") {
    return isBlankString(value) ? createImagePlaceholder(seed, 1200, 800) : value;
  }

  if (type === "video" || type === "video_url") {
    return isBlankString(value) ? SAMPLE_VIDEO_URL : value;
  }

  if (type === "font_picker") {
    return toFontPickerValue(value, seed);
  }

  if (type === "url") {
    return isBlankString(value) ? "#" : value;
  }

  if (type === "collection") {
    return toCollectionObject(value, seed);
  }

  if (type === "product") {
    return toProductObject(value, "product", seed);
  }

  if (type === "article" || type === "blog" || type === "page") {
    return toGenericResourceObject(value, type, seed);
  }

  if (type === "collection_list") {
    return ensureResourceList(value, "collections", seed);
  }

  if (type === "product_list") {
    return ensureResourceList(value, "products", seed);
  }

  if (type === "metaobject_list") {
    return ensureResourceList(value, "custom.sample", seed);
  }

  if (type === "metaobject") {
    return toMetaobjectValue(value, seed);
  }

  if (type === "link_list") {
    return toMenuValue(value, seed);
  }

  return value;
}

function applySettingFallbacks(
  settings: LiquidSchemaSetting[],
  values: Record<string, LiquidSettingJsonValue>,
  seedPrefix: string,
): Record<string, LiquidSettingJsonValue> {
  let nextValues: Record<string, LiquidSettingJsonValue> = values;

  for (const setting of settings) {
    const seed = `${seedPrefix}-${setting.id}`;
    const currentValue = values[setting.id];
    const nextValue = applySettingFallback(setting, currentValue, seed);

    if (Object.is(nextValue, currentValue)) {
      continue;
    }

    if (nextValues === values) {
      nextValues = { ...values };
    }
    nextValues[setting.id] = nextValue;
  }

  return nextValues;
}

export function applyLiquidPreviewFallbacks(
  schema: LiquidSchema,
  state: LiquidEditorState,
): LiquidEditorState {
  const sectionSettings = applySettingFallbacks(schema.settings, state.sectionSettings, "section");
  const blockDefinitionByType = getBlockDefinitionLookup(schema);

  let blocks = state.blocks;
  for (const [index, block] of state.blocks.entries()) {
    const definition = blockDefinitionByType.get(block.type);
    if (!definition) {
      continue;
    }

    const settings = applySettingFallbacks(
      definition.settings,
      block.settings,
      `block-${normalizeSlug(block.type)}-${index + 1}`,
    );

    if (settings === block.settings) {
      continue;
    }

    if (blocks === state.blocks) {
      blocks = [...state.blocks];
    }

    blocks[index] = {
      ...block,
      settings,
    };
  }

  if (sectionSettings === state.sectionSettings && blocks === state.blocks) {
    return state;
  }

  return {
    sectionSettings,
    blocks,
  };
}
