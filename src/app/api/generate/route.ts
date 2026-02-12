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

        // 2. Initial Validation
        const stabilityKeys = [
            process.env.Home_STABILITY_API_KEY, // Priority 1: New Account
            process.env.STABILITY_API_KEY,
            process.env.NZ_STABILITY_API_KEY
        ].filter(Boolean) as string[];

        if (stabilityKeys.length === 0) {
            throw new Error("Missing STABILITY_API_KEY in Environment Variables.");
        }

        const remoteWorkerUrl = process.env.REMOTE_WORKER_URL;
        const remoteWorkerKey = process.env.REMOTE_WORKER_KEY;

        let result = null;
        const isVercel = process.env.VERCEL === "1";

        // --- LEVEL 1: Remote Worker (HF) ---
        if (remoteWorkerUrl) {
            try {
                console.log("Tier 1: Calling Remote Python Worker...");
                // On Vercel Hobby, we must bail early if HF is slow to allow Fallback to run
                const timeout = isVercel ? 7000 : 60000;

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
                    signal: AbortSignal.timeout(timeout)
                });

                if (response.ok) {
                    const data = await response.json();
                    if (data.success) {
                        result = { image: data.image, method: "remote_worker" };
                        console.log("Tier 1 SUCCESS");
                    } else {
                        console.warn("Tier 1 Worker Error:", data.error);
                    }
                } else {
                    console.warn(`Tier 1 HTTP ${response.status}`);
                }
            } catch (err: any) {
                console.warn("Tier 1 Skipped:", err.name === 'AbortError' ? "Timeout (HF too slow)" : err.message);
            }
        }

        // --- LEVEL 2: Local Command Line (Only if NOT on Vercel) ---
        if (!result && !isVercel) {
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

        // --- LEVEL 3: Pure AI Cloud Fallback ---
        if (!result) {
            console.log("Tier 3: Starting Pure AI Fallback...");

            let visionPrompt = prompt;
            const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

            // On Vercel, only do Gemini if we have enough time left
            if (geminiKey && tempFiles.length > 0) {
                try {
                    const genAI = new GoogleGenerativeAI(geminiKey);
                    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
                    const visionResult = await model.generateContent([
                        "Describe room type and style in 10 words.",
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
                        result = { image: `data:image/webp;base64,${data.image}`, method: "pure_ai_ultra" };
                        break;
                    } else {
                        console.error("Stability API Error:", data.message || response.statusText);
                    }
                } catch (e: any) {
                    console.error("Tier 3 Request Error:", e.message);
                }
            }
        }

        if (!result) throw new Error("All generation methods failed. Check STABILITY_API_KEY credits or connection.");

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
