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
                const base64Images = tempFiles.map(f => fs.readFileSync(f).toString("base64"));

                const response = await fetch(remoteWorkerUrl, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "X-API-Key": remoteWorkerKey || ""
                    },
                    body: JSON.stringify({
                        prompt,
                        images: base64Images,
                        style: "photographic"
                    }),
                    signal: AbortSignal.timeout(90000) // Extended to 90s for high-quality stitching
                });

                if (response.ok) {
                    const data = await response.json();
                    if (data.success) {
                        result = { image: data.image, method: "remote_worker" };
                        console.log("Remote worker success!");
                    } else {
                        console.warn("Remote worker internal error:", data.error);
                    }
                } else {
                    const errText = await response.text();
                    console.error("Remote worker HTTP error:", response.status, errText);
                }
            } catch (err: any) {
                console.warn("Remote worker fallback...", err.message);
            }
        }

        // --- LEVEL 2: Local Command Line (Skip on Vercel) ---
        if (!result && process.env.VERCEL !== "1") {
            const pythonScript = path.join(process.cwd(), "scripts", "processor.py");
            const imageArgs = tempFiles.map(img => `"${img}"`).join(" ");

            for (let i = 0; i < stabilityKeys.length; i++) {
                try {
                    console.log(`Tier 2: Attempting local pipeline with Key ${i}...`);
                    const { stdout } = await execAsync(`python "${pythonScript}" "${stabilityKeys[i]}" "${prompt.replace(/"/g, '\\"')}" ${imageArgs}`, { maxBuffer: 1024 * 1024 * 20 });
                    const parsed = JSON.parse(stdout);
                    if (parsed.success) {
                        result = parsed;
                        break;
                    }
                } catch (err: any) {
                    console.warn(`Local attempt failed:`, err.message);
                }
            }
        }

        // --- LEVEL 3: Pure AI Cloud Fallback (Vision-Aware) ---
        if (!result) {
            console.log("Tier 3: Using Vision-Enhanced AI cloud fallback...");

            if (stabilityKeys.length === 0) {
                throw new Error("No Stability API keys found.");
            }

            // Gemini Analysis
            let visionPrompt = prompt;
            const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

            if (geminiKey && tempFiles.length > 0) {
                try {
                    const genAI = new GoogleGenerativeAI(geminiKey);
                    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
                    const fileData = fs.readFileSync(tempFiles[0]);

                    const visionResult = await model.generateContent([
                        "Describe the visual style, lighting, and specific room type of this photo (e.g. modern bathroom, sunny living room) in 20 words for an AI image generator.",
                        { inlineData: { data: fileData.toString("base64"), mimeType: "image/png" } }
                    ]);
                    const description = visionResult.response.text();
                    visionPrompt = `${prompt}. Style: ${description}`;
                    console.log("Vision Context:", description);
                } catch (e) {
                    console.warn("Vision analysis skipped.");
                }
            }

            for (const key of stabilityKeys) {
                try {
                    const aiFormData = new FormData();
                    aiFormData.append("prompt", `${visionPrompt}, high quality 360 degree equirectangular panorama, VR ready, seamless horizon`);
                    aiFormData.append("output_format", "webp");
                    aiFormData.append("aspect_ratio", "21:9");

                    const response = await fetch("https://api.stability.ai/v2beta/stable-image/generate/ultra", {
                        method: "POST",
                        headers: { "Authorization": `Bearer ${key}`, "Accept": "application/json" },
                        body: aiFormData
                    });

                    const data = await response.json();
                    if (response.ok && data.image) {
                        result = { image: `data:image/webp;base64,${data.image}`, method: "pure_ai" };
                        break;
                    }
                } catch (e: any) { continue; }
            }
        }

        if (!result) throw new Error("Pipeline Exhausted: All tiers failed.");

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
