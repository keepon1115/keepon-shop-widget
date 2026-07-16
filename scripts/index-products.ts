/**
 * 商品インデックス用CLIスクリプト
 * 使い方: npx tsx scripts/index-products.ts ./karami.csv
 *
 * カラーミーの商品CSV（Shift-JIS）を読み込み、商品ごとに埋め込みを生成して
 * Supabaseの shop_products にupsertする。再実行で全件差し替え可能。
 */
import fs from "node:fs";
import path from "node:path";
import iconv from "iconv-lite";
import { parse } from "csv-parse/sync";
import { createSupabaseAdmin } from "../lib/supabaseAdmin";
import { createGemini, embedTexts, TaskType } from "../lib/gemini";

const SHOP_BASE_URL = "https://keepon-web.com/?pid=";
const EMBED_BATCH_SIZE = 100;
const EMBED_BATCH_SLEEP_MS = 65_000;
const EMBED_MAX_RETRIES = 5;
const UPSERT_BATCH_SIZE = 500;
const DESCRIPTION_MAX_LENGTH = 2000;
const EMBED_INPUT_DESCRIPTION_LENGTH = 500;

type CsvRow = Record<string, string>;

type ProductRecord = {
  product_id: string;
  name: string;
  category_l: string | null;
  category_s: string | null;
  model: string | null;
  price: number | null;
  image_url: string | null;
  url: string;
  summary: string | null;
  description: string | null;
  in_stock: boolean;
};

function loadEnv() {
  for (const file of [".env.local", ".env"]) {
    try {
      process.loadEnvFile(file);
      return;
    } catch {
      // ファイルが無ければ次を試す
    }
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function toNullableText(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function toPrice(value: string | undefined): number | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const n = Number.parseInt(trimmed, 10);
  return Number.isFinite(n) ? n : null;
}

function isPublished(row: CsvRow): boolean {
  if (!("掲載設定" in row)) return true;
  return row["掲載設定"]?.trim() === "掲載する";
}

function isInStock(row: CsvRow): boolean {
  if (row["在庫管理"]?.trim() === "在庫管理しない") return true;
  const stock = Number.parseInt(row["在庫数"]?.trim() ?? "", 10);
  return Number.isFinite(stock) && stock > 0;
}

function buildProductRecord(row: CsvRow): ProductRecord {
  const productId = row["商品ID"]?.trim();
  const description = row["商品説明"] ? stripHtml(row["商品説明"]).slice(0, DESCRIPTION_MAX_LENGTH) : null;

  return {
    product_id: productId,
    name: row["商品名"]?.trim() ?? "",
    category_l: toNullableText(row["大カテゴリー"]),
    category_s: toNullableText(row["小カテゴリー"]),
    model: toNullableText(row["型番"]),
    price: toPrice(row["販売価格"]),
    image_url: toNullableText(row["商品画像URL"]),
    url: `${SHOP_BASE_URL}${productId}`,
    summary: toNullableText(row["簡易説明"]),
    description,
    in_stock: isInStock(row),
  };
}

function buildEmbeddingInput(record: ProductRecord): string {
  const categoryPath = [record.category_l, record.category_s].filter(Boolean).join(" > ");
  const descriptionHead = record.description?.slice(0, EMBED_INPUT_DESCRIPTION_LENGTH) ?? "";
  return [record.name, categoryPath, record.summary ?? "", descriptionHead]
    .filter(Boolean)
    .join(" / ");
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error("使い方: npx tsx scripts/index-products.ts <CSVファイルパス>");
    process.exit(1);
  }

  loadEnv();

  const resolvedPath = path.resolve(csvPath);
  console.log(`CSV読み込み中: ${resolvedPath}`);
  const buffer = fs.readFileSync(resolvedPath);
  const text = iconv.decode(buffer, "Shift_JIS");

  const rows: CsvRow[] = parse(text, {
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
    relax_column_count: true,
  });

  const publishedRows = rows.filter(isPublished);
  console.log(
    `全${rows.length}件中、掲載対象 ${publishedRows.length}件（非掲載スキップ ${rows.length - publishedRows.length}件）`
  );

  const allRecords = publishedRows
    .map(buildProductRecord)
    .filter((r) => r.product_id && r.name);

  const genAI = createGemini();
  const supabase = createSupabaseAdmin();

  const { data: alreadyIndexed, error: alreadyIndexedError } = await supabase
    .from("shop_products")
    .select("product_id")
    .not("embedding", "is", null);
  if (alreadyIndexedError) {
    throw new Error(`登録済み商品IDの取得に失敗: ${alreadyIndexedError.message}`);
  }
  const alreadyIndexedIds = new Set((alreadyIndexed ?? []).map((r) => r.product_id as string));
  const records = allRecords.filter((r) => !alreadyIndexedIds.has(r.product_id));
  if (alreadyIndexedIds.size > 0) {
    console.log(`登録済み ${alreadyIndexedIds.size}件をスキップ（未登録 ${records.length}件を処理します）`);
  }

  const total = records.length;
  for (let i = 0; i < total; i += EMBED_BATCH_SIZE) {
    const batch = records.slice(i, i + EMBED_BATCH_SIZE);
    const inputs = batch.map(buildEmbeddingInput);

    let embeddings: number[][] | undefined;
    let lastErr: Error | undefined;
    for (let attempt = 0; attempt < EMBED_MAX_RETRIES; attempt++) {
      try {
        embeddings = await embedTexts(genAI, inputs, TaskType.RETRIEVAL_DOCUMENT);
        break;
      } catch (err) {
        lastErr = err as Error;
        const isRateLimit = /429|quota/i.test(lastErr.message);
        const waitMs = isRateLimit ? EMBED_BATCH_SLEEP_MS : 5000;
        console.warn(
          `埋め込み生成に失敗（${attempt + 1}/${EMBED_MAX_RETRIES}回目、${Math.round(waitMs / 1000)}秒待って再試行）: ${lastErr.message}`
        );
        await sleep(waitMs);
      }
    }
    if (!embeddings) {
      throw lastErr ?? new Error("埋め込み生成に失敗しました");
    }

    const upsertRows = batch.map((record, idx) => ({
      ...record,
      embedding: embeddings[idx],
      updated_at: new Date().toISOString(),
    }));

    for (let j = 0; j < upsertRows.length; j += UPSERT_BATCH_SIZE) {
      const chunk = upsertRows.slice(j, j + UPSERT_BATCH_SIZE);
      const { error } = await supabase.from("shop_products").upsert(chunk, { onConflict: "product_id" });
      if (error) {
        throw new Error(`Supabase upsertに失敗: ${error.message}`);
      }
    }

    const processed = Math.min(i + EMBED_BATCH_SIZE, total);
    console.log(`${processed}/${total} 件処理済み`);

    if (i + EMBED_BATCH_SIZE < total) {
      await sleep(EMBED_BATCH_SLEEP_MS);
    }
  }

  // CSVに存在しなくなった商品を削除
  const currentIds = new Set(allRecords.map((r) => r.product_id));
  const { data: existing, error: fetchError } = await supabase.from("shop_products").select("product_id");
  if (fetchError) {
    throw new Error(`既存商品IDの取得に失敗: ${fetchError.message}`);
  }

  const staleIds = (existing ?? [])
    .map((r) => r.product_id as string)
    .filter((id) => !currentIds.has(id));

  if (staleIds.length > 0) {
    for (let i = 0; i < staleIds.length; i += UPSERT_BATCH_SIZE) {
      const chunk = staleIds.slice(i, i + UPSERT_BATCH_SIZE);
      const { error } = await supabase.from("shop_products").delete().in("product_id", chunk);
      if (error) {
        throw new Error(`不要商品の削除に失敗: ${error.message}`);
      }
    }
    console.log(`CSVに存在しなくなった商品を削除: ${staleIds.length}件`);
  }

  console.log(`完了: ${total}件を登録・更新しました。`);
}

main().catch((err) => {
  console.error("インデックス処理でエラーが発生しました:", err);
  process.exit(1);
});
