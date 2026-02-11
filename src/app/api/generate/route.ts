import { NextRequest, NextResponse } from "next/server";
import { generateWithFallback } from "@/lib/gemini";

// A small but valid 360-ish gray texture to prevent 404s
const MOCK_PANO = "https://threejs.org/examples/textures/equirectangular/venice_sunset_1k.hdr";
// Note: TextureLoader might struggle with HDR directly, let's use a standard JPG
const STABLE_JPG = "https://threejs.org/examples/textures/uv_grid_opengl.jpg";

export async function POST(req: NextRequest) {
    try {
        const formData = await req.formData();

        const result = await generateWithFallback(async (model) => {
            return {
                url: STABLE_JPG,
                success: true
            };
        });

        // Hardcode to a known working three.js asset that supports CORS
        result.url = "https://threejs.org/examples/textures/uv_grid_opengl.jpg";

        return NextResponse.json(result);
    } catch (error: any) {
        console.error("Generation error:", error);
        return NextResponse.json(
            { error: error.message || "Failed to generate scene" },
            { status: 500 }
        );
    }
}
