/**
 * Gemini APIキーが「無料枠(FreeTier)」か「有料枠(課金あり)」かを1リクエストで判定する確認スクリプト。
 * 使い方: npx tsx scripts/check-gemini-tier.ts
 *
 * .env.local の GEMINI_API_KEY を読み、gemini-embedding-001 に embedContent を1回だけ投げる。
 *  - 200        → キーは使える。日次枠が残っている（有料枠に切り替わっていれば通常こちら）。
 *  - 429 + free_tier メトリクス → このキーは無料枠。日次1000件の上限で頭打ちになっている。
 *  - 429 + それ以外           → 課金済みだが分/トークン単位の一時的な上限。少し待てば回復。
 * チャットが「ただいま混み合っています」を返すのと同じ埋め込み呼び出しなので、
 * 本番の症状をそのまま切り分けられる。
 */
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

async function main() {
  loadEnv();

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("GEMINI_API_KEY が見つかりません（.env.local を確認してください）");
    process.exit(1);
  }

  const endpoint =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=" +
    apiKey;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "models/gemini-embedding-001",
      content: { parts: [{ text: "テスト" }] },
      outputDimensionality: 768,
    }),
  });

  const bodyText = await res.text();
  console.log(`HTTP ${res.status} ${res.statusText}`);

  if (res.ok) {
    console.log("✅ 判定: このキーで埋め込みAPIは正常に動いています（枠が残っています）。");
    console.log("   → 有料キーに差し替えた後にこの結果が出れば、切り替え成功です。");
    return;
  }

  // エラー時は quota メトリクス名で無料/有料を切り分ける
  const isFreeTier = /free_tier/i.test(bodyText);
  const isQuota = /429|RESOURCE_EXHAUSTED|quota/i.test(bodyText);

  if (isQuota && isFreeTier) {
    console.log("❌ 判定: このキーは【無料枠(FreeTier)】です。日次1000件の埋め込み上限に張り付いています。");
    console.log("   → 課金済みプロジェクトのキーに差し替える必要があります。");
  } else if (isQuota) {
    console.log("⚠️ 判定: 課金済みの可能性が高いですが、一時的なレート上限に当たっています。少し待って再実行してください。");
  } else {
    console.log("⚠️ 想定外のエラーです。下の応答本文を確認してください。");
  }

  console.log("--- 応答本文（抜粋）---");
  console.log(bodyText.slice(0, 800));
}

main().catch((err) => {
  console.error("確認スクリプトでエラー:", err);
  process.exit(1);
});
