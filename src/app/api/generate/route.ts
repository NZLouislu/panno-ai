import { NextRequest, NextResponse } from "next/server";
import { generateWithFallback } from "@/lib/gemini";

export async function POST(req: NextRequest) {
    try {
        const formData = await req.formData();
        const prompt = formData.get("prompt") as string || "a modern interior";
        const images = formData.getAll("images") as File[];

        // 1. Prepare images (Stripping prefix and converting to base64)
        const imageParts = await Promise.all(
            images.map(async (file) => {
                const buffer = await file.arrayBuffer();
                return {
                    inlineData: {
                        data: Buffer.from(buffer).toString("base64"),
                        mimeType: file.type,
                    },
                };
            })
        );

        const task = async (model: any) => {
            const parts = [
                {
                    text: `Analyze these photos and the prompt: "${prompt}". 
                         Describe a consistent 360-degree indoor panorama scene. 
                         Identify key features: flooring, lighting, layout, and style.
                         Output the analysis in English.` },
                ...imageParts
            ];

            const result = await model.generateContent({
                contents: [{ role: "user", parts }],
            });

            const response = await result.response;
            return response.text();
        };

        // 2. Sequential fallback: Try 2.5-flash-image first, then 2.0-flash
        let analysis: string;
        try {
            console.log("Attempting generation with gemini-2.5-flash-image...");
            analysis = await generateWithFallback(task, 0, "gemini-2.5-flash-image");
        } catch (err25: any) {
            console.warn("gemini-2.5-flash-image failed (likely quota), falling back to 2.0-flash", err25.message);
            analysis = await generateWithFallback(task, 0, "gemini-2.0-flash");
        }

        console.log("Gemini Analysis Successful:", analysis.substring(0, 100) + "...");

        // 3. Mapping Analysis to stable targets
        const templates: Record<string, string> = {
            "modern": "https://dl.polyhaven.org/file/ph-assets/Environments/jpg/1k/modern_bathroom.jpg",
            "wood": "https://dl.polyhaven.org/file/ph-assets/Environments/jpg/1k/empty_warehouse_01.jpg",
            "living": "https://dl.polyhaven.org/file/ph-assets/Environments/jpg/1k/kiara_interior_02.jpg",
            "default": "/test_pano.jpg" // Local stable asset as bottom fallback
        };

        const lowerAnalysis = analysis.toLowerCase();
        let selectedUrl = templates.default;

        // Priority mapping based on keywords
        if (lowerAnalysis.includes("living") || lowerAnalysis.includes("lounge")) selectedUrl = templates.living;
        else if (lowerAnalysis.includes("wood") || lowerAnalysis.includes("brown")) selectedUrl = templates.wood;
        else if (lowerAnalysis.includes("modern") || lowerAnalysis.includes("bathroom") || lowerAnalysis.includes("white")) selectedUrl = templates.modern;

        return NextResponse.json({
            url: selectedUrl,
            success: true,
            analysis: analysis
        });

    } catch (error: any) {
        console.error("API Ultimate Error:", error.message);
        return NextResponse.json({
            url: "/test_pano.jpg",
            success: true,
            isFallback: true,
            message: "API Limit Reached. Showing stable preview.",
            analysis: "Could not reach Gemini. Please check your API Quota."
        });
    }
}
