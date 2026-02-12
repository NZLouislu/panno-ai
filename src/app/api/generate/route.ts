import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import os from "os";
import { GoogleGenerativeAI } from "@google/generative-ai";

const execAsync = promisify(exec);

export async function POST(req: NextRequest) {
    const tempFiles: string[] = [];
    try {
        const formData = await req.formData();
        const prompt = formData.get("prompt") as string || "a photographic 360 panorama";
        const images = formData.getAll("images") as File[];

        // 1. Save uploaded images to temp directory
        const tempDir = path.join(os.tmpdir(), `panno-${Date.now()}`);
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

        for (let i = 0; i < images.length; i++) {
            const buffer = Buffer.from(await images[i].arrayBuffer());
            const fileName = path.join(tempDir, `img_${i}.png`);
            fs.writeFileSync(fileName, buffer);
            tempFiles.push(fileName);
        }

        // 2. Load Config & Keys
        const stabilityKeys = [
            process.env.STABILITY_API_KEY,
            process.env.NZ_STABILITY_API_KEY
        ].filter(Boolean) as string[];

        const remoteWorkerUrl = process.env.REMOTE_WORKER_URL;
        const remoteWorkerKey = process.env.REMOTE_WORKER_KEY;

        let result = null;

        // --- LEVEL 1: Remote Worker (Hugging Face Space) ---
        if (remoteWorkerUrl) {
            try {
                console.log("Tier 1: Calling Remote Python Worker...");
                const response = await fetch(remoteWorkerUrl, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "X-API-Key": remoteWorkerKey || ""
                    },
                    body: JSON.stringify({
                        prompt,
                        images: tempFiles.map(f => fs.readFileSync(f).toString("base64")),
                        style: "photographic"
                    }),
                    signal: AbortSignal.timeout(60000)
                });

                if (response.ok) {
                    const data = await response.json();
                    if (data.success) {
                        result = { image: data.image, method: "remote_worker" };
                        console.log("Tier 1 SUCCESS");
                    } else {
                        console.warn("Tier 1 logic error:", data.error);
                    }
                } else {
                    console.warn(`Tier 1 HTTP error: ${response.status}`);
                }
            } catch (err: any) {
                console.warn("Tier 1 Failed:", err.name === 'AbortError' ? "Vercel/Network Timeout" : err.message);
            }
        }

        // --- LEVEL 2: Local Command Line (Skip on Vercel) ---
        if (!result && process.env.VERCEL !== "1") {
            try {
                const pythonScript = path.join(process.cwd(), "scripts", "processor.py");
                const imageArgs = tempFiles.map(img => `"${img}"`).join(" ");
                console.log("Tier 2: Local Execution...");
                const { stdout } = await execAsync(`python "${pythonScript}" "${stabilityKeys[0]}" "${prompt.replace(/"/g, '\\"')}" ${imageArgs}`, { maxBuffer: 1024 * 1024 * 20 });
                const parsed = JSON.parse(stdout);
                if (parsed.success) result = parsed;
            } catch (err: any) {
                console.warn("Tier 2 Failed:", err.message);
            }
        }

        // --- LEVEL 3: Pure AI Cloud Fallback (Vision-Aware) ---
        if (!result) {
            console.log("Tier 3: Starting Vision-Enhanced AI fallback...");

            let visionPrompt = prompt;
            const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

            if (geminiKey && tempFiles.length > 0) {
                try {
                    const genAI = new GoogleGenerativeAI(geminiKey);
                    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
                    const visionResult = await model.generateContent([
                        "Describe room type and furniture in 15 words.",
                        { inlineData: { data: fs.readFileSync(tempFiles[0]).toString("base64"), mimeType: "image/png" } }
                    ]);
                    visionPrompt = `${prompt}. Style: ${visionResult.response.text()}`;
                } catch (e) { }
            }

            for (const key of stabilityKeys) {
                try {
                    const aiFormData = new FormData();
                    aiFormData.append("prompt", `${visionPrompt}, 360 panorama, wide angle, high quality, seamless`);
                    aiFormData.append("output_format", "webp");
                    aiFormData.append("aspect_ratio", "21:9");

                    const response = await fetch("https://api.stability.ai/v2beta/stable-image/generate/ultra", {
                        method: "POST",
                        headers: { "Authorization": `Bearer ${key}`, "Accept": "application/json" },
                        body: aiFormData
                    });

                    const data = await response.json();
                    if (response.ok && data.image) {
                        result = { image: `data:image/webp;base66,${data.image}`, method: "pure_ai_ultra" };
                        break;
                    } else {
                        console.error("Tier 3 API Error:", data.message || response.statusText);
                    }
                } catch (e: any) {
                    console.error("Tier 3 Request Error:", e.message);
                }
            }
        }

        if (!result) throw new Error("Pipeline Exhausted: All tiers failed. Possible timeout or quota issue.");

        return NextResponse.json({
            url: result.image,
            success: true,
            method: result.method || "cv_ai_hybrid"
        });


    } catch (error: any) {
        console.error("Pipeline Error:", error.message);
        return NextResponse.json({
            success: false,
            message: error.message || "Failed to process panorama"
        }, { status: 500 });
    } finally {
        // Cleanup temp files
        try {
            tempFiles.forEach(f => {
                if (fs.existsSync(f)) fs.unlinkSync(f);
            });
            const dir = path.dirname(tempFiles[0]);
            if (dir && fs.existsSync(dir)) fs.rmdirSync(dir);
        } catch (e) { }
    }
}
