import { EmbedContentRequest, GoogleGenerativeAI, TaskType } from "@google/generative-ai";

export function createGemini() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY が設定されていません（.env.local を確認してください）");
  }
  return new GoogleGenerativeAI(apiKey);
}

// Supabase側の embedding 列が vector(768) 固定のため、768次元に切り詰めて出力する
const EMBEDDING_DIMENSIONS = 768;

/** gemini-embedding-001 でテキスト配列をまとめて埋め込む（最大100件/回を想定） */
export async function embedTexts(
  genAI: GoogleGenerativeAI,
  texts: string[],
  taskType: TaskType
): Promise<number[][]> {
  const model = genAI.getGenerativeModel({ model: "gemini-embedding-001" });
  const { embeddings } = await model.batchEmbedContents({
    requests: texts.map((text) => ({
      content: { role: "user", parts: [{ text }] },
      taskType,
      outputDimensionality: EMBEDDING_DIMENSIONS,
    } as EmbedContentRequest & { outputDimensionality: number })),
  });
  return embeddings.map((e) => e.values);
}

export { TaskType };
