import { SchemaType } from "@google/generative-ai";
import { createGemini, embedTexts, TaskType } from "@/lib/gemini";
import { createSupabaseAdmin } from "@/lib/supabaseAdmin";
import { corsHeaders, getClientIp, isRateLimited, resolveAllowedOrigin } from "@/lib/corsRateLimit";

export const runtime = "nodejs";

const MESSAGE_MAX_LENGTH = 500;
const SEARCH_MATCH_COUNT = 12;
const MAX_HISTORY_TURNS = 5;

type ChatHistoryItem = { role: "user" | "assistant"; text: string };
type ChatRequestBody = { message: string; history?: ChatHistoryItem[] };

type SearchResult = {
  product_id: string;
  name: string;
  category_l: string | null;
  category_s: string | null;
  price: number | null;
  image_url: string | null;
  url: string;
  summary: string | null;
  in_stock: boolean;
};

const SYSTEM_INSTRUCTION = `
あなたは「キープオンショップ」の商品探しアシスタントです。保育園・幼稚園・学校向けの
教材や行事用品を扱うお店で、明るく、ていねいで、押し付けない接客をします。

- あなたは商品探し専用のアシスタントです。送料・納期・注文変更などの質問には
  「このチャットは商品探し専用です。お問い合わせは画面のチャットサポートか
  お問い合わせページへどうぞ」と案内し、product_idsは空にしてください。
- 提示する商品は、渡された検索結果の中からのみ選んでください。存在しない商品をでっち上げないでください。
- 検索結果がしっくりこない場合は、用途・対象年齢・色・予算などを1つだけ聞き返してください
  （質問攻めにしない。1ターンにつき質問は1つ）。
- 在庫切れ商品は原則選ばないでください。選択肢が乏しい場合のみ「在庫切れ」と明記して提示してよいです。
- replyは3文以内で、絵文字は使っても1個までにしてください。長文説明はしないでください。
- 必ず次のJSON形式のみで応答してください: { "reply": string, "product_ids": string[] }
  product_idsは0〜4件です。
`.trim();

function jsonResponse(body: unknown, status: number, origin: string | null) {
  return Response.json(body, { status, headers: corsHeaders(origin) });
}

export async function OPTIONS(request: Request) {
  const origin = request.headers.get("origin");
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");

  if (origin && !resolveAllowedOrigin(origin)) {
    return jsonResponse({ error: "許可されていないオリジンです。" }, 403, null);
  }

  const ip = getClientIp(request);
  if (isRateLimited(ip)) {
    return jsonResponse(
      { error: "少し時間をおいてお試しください。", reply: "少し時間をおいてお試しください。", products: [] },
      429,
      origin
    );
  }

  let body: ChatRequestBody;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "リクエストの形式が不正です。" }, 400, origin);
  }

  const message = body.message?.trim();
  if (!message || message.length > MESSAGE_MAX_LENGTH) {
    return jsonResponse(
      { error: `messageは1〜${MESSAGE_MAX_LENGTH}文字で指定してください。` },
      400,
      origin
    );
  }

  const history = (body.history ?? []).slice(-MAX_HISTORY_TURNS * 2);
  const lastUserUtterance = [...history].reverse().find((h) => h.role === "user")?.text ?? "";
  const embedInput = [message, lastUserUtterance].filter(Boolean).join(" / ");

  try {
    const genAI = createGemini();
    const supabase = createSupabaseAdmin();

    const [queryEmbedding] = await embedTexts(genAI, [embedInput], TaskType.RETRIEVAL_QUERY);

    const { data: searchResults, error: searchError } = await supabase.rpc("match_shop_products", {
      query_embedding: queryEmbedding,
      match_count: SEARCH_MATCH_COUNT,
    });
    if (searchError) throw searchError;

    const results = (searchResults ?? []) as SearchResult[];

    const model = genAI.getGenerativeModel({
      model: "gemini-3.1-flash-lite",
      systemInstruction: SYSTEM_INSTRUCTION,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            reply: { type: SchemaType.STRING },
            product_ids: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
          },
          required: ["reply", "product_ids"],
        },
      },
    });

    const searchResultsText = results
      .map(
        (r) =>
          `- ID:${r.product_id} / ${r.name} / ${[r.category_l, r.category_s].filter(Boolean).join(">")} / ${
            r.price != null ? `${r.price}円` : "価格不明"
          } / ${r.in_stock ? "在庫あり" : "在庫切れ"} / ${r.summary ?? ""}`
      )
      .join("\n");

    const historyText = history.map((h) => `${h.role === "user" ? "ユーザー" : "アシスタント"}: ${h.text}`).join("\n");

    const prompt = `
【検索結果（上位${results.length}件）】
${searchResultsText || "（該当なし）"}

【会話履歴】
${historyText || "（なし）"}

【今回のユーザー発話】
${message}
`.trim();

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();

    let parsed: { reply: string; product_ids: string[] };
    try {
      parsed = JSON.parse(responseText);
    } catch {
      parsed = { reply: "うまく回答を作れませんでした。もう一度お試しください。", product_ids: [] };
    }

    const productIds = (parsed.product_ids ?? []).slice(0, 4);
    const resultById = new Map(results.map((r) => [r.product_id, r]));
    const products = productIds
      .map((id) => resultById.get(id))
      .filter((r): r is SearchResult => Boolean(r))
      .map((r) => ({ name: r.name, price: r.price, image_url: r.image_url, url: r.url }));

    return jsonResponse({ reply: parsed.reply, products }, 200, origin);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isQuotaError = /429|RESOURCE_EXHAUSTED|quota/i.test(message);

    if (isQuotaError) {
      console.error("shop-chat quota error:", err);
      return jsonResponse(
        { reply: "ただいま混み合っています。少し時間をおいてお試しください。", products: [] },
        200,
        origin
      );
    }

    console.error("shop-chat error:", err);
    return jsonResponse(
      { reply: "エラーが発生しました。時間をおいて再度お試しください。", products: [] },
      500,
      origin
    );
  }
}
