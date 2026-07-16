-- キープオンショップ AI商品検索チャットウィジェット用テーブル
-- 商品データ本体 + ベクトル類似検索RPC

create extension if not exists vector;

create table if not exists shop_products (
  product_id   text primary key,       -- CSV「商品ID」
  name         text not null,          -- 「商品名」
  category_l   text,                   -- 「大カテゴリー」
  category_s   text,                   -- 「小カテゴリー」
  model        text,                   -- 「型番」
  price        integer,                -- 「販売価格」
  image_url    text,                   -- 「商品画像URL」
  url          text not null,          -- https://keepon-web.com/?pid={商品ID}
  summary      text,                   -- 「簡易説明」
  description  text,                   -- 「商品説明」HTMLタグ除去済み・2000字で切る
  in_stock     boolean default true,   -- 「在庫数」>0 または在庫管理しない場合 true
  embedding    vector(768),
  updated_at   timestamptz not null default now()
);

create index if not exists shop_products_embedding_idx
  on shop_products using hnsw (embedding vector_cosine_ops);

-- 類似検索RPC: cosine距離順に上位match_count件を返す
create or replace function match_shop_products(
  query_embedding vector(768),
  match_count int default 12
)
returns table (
  product_id  text,
  name        text,
  category_l  text,
  category_s  text,
  price       integer,
  image_url   text,
  url         text,
  summary     text,
  in_stock    boolean,
  similarity  float
)
language sql stable
as $$
  select
    sp.product_id,
    sp.name,
    sp.category_l,
    sp.category_s,
    sp.price,
    sp.image_url,
    sp.url,
    sp.summary,
    sp.in_stock,
    1 - (sp.embedding <=> query_embedding) as similarity
  from shop_products sp
  where sp.embedding is not null
  order by sp.embedding <=> query_embedding
  limit match_count;
$$;
