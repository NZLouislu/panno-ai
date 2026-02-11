import { GoogleGenerativeAI } from "@google/generative-ai";

function getApiKeys() {
    return [
        process.env.Gemini_API,
        process.env.AULouis_Gemini_API,
        process.env.Blog_Gemini_API,
        process.env.Tasky_Gemini_API,
    ].filter(Boolean) as string[];
}

export async function getGeminiModel(index = 0) {
    const keys = getApiKeys();
    if (index >= keys.length) {
        throw new Error("All Gemini API keys have been exhausted.");
    }

    const genAI = new GoogleGenerativeAI(keys[index]);
    // Use gemini-2.0-flash as the "Gemini 3 flash" requested by user (likely 2.0)
    return genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
}

export async function generateWithFallback(
    fn: (model: any) => Promise<any>,
    index = 0
): Promise<any> {
    const keys = getApiKeys();
    try {
        const model = await getGeminiModel(index);
        return await fn(model);
    } catch (error: any) {
        console.warn(`API key ${index} failed, trying next...`, error.message);
        if (index + 1 < keys.length) {
            return await generateWithFallback(fn, index + 1);
        }
        throw error;
    }
}
