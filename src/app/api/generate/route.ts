import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import os from "os";

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

        // 2. Load API Keys
        const stabilityKeys = [
            process.env.STABILITY_API_KEY,
            process.env.NZ_STABILITY_API_KEY
        ].filter(Boolean) as string[];

        // 3. Execution Logic: CV-Hybrid vs Pure-AI
        const isVercel = process.env.VERCEL === "1";
        let result = null;

        if (!isVercel) {
            // --- LOCAL MODE: Use OpenCV + Python ---
            const pythonScript = path.join(process.cwd(), "scripts", "processor.py");
            const imageArgs = tempFiles.map(img => `"${img}"`).join(" ");

            for (let i = 0; i < stabilityKeys.length; i++) {
                const currentKey = stabilityKeys[i];
                try {
                    const command = `python "${pythonScript}" "${currentKey}" "${prompt.replace(/"/g, '\\"')}" ${imageArgs}`;
                    console.log(`Attempting hybrid pipeline with Stability Key ${i}...`);
                    const { stdout } = await execAsync(command, { maxBuffer: 1024 * 1024 * 20 });
                    const parsed = JSON.parse(stdout);
                    if (parsed.success) {
                        result = parsed;
                        break;
                    }
                } catch (err: any) {
                    console.warn(`Key ${i} CV failed, trying next...`, err.message);
                }
            }
        }

        // --- CLOUD FALLBACK: Pure AI Mode (If CV fails or is not available) ---
        if (!result) {
            console.log("Using Pure-AI cloud fallback...");

            if (stabilityKeys.length === 0) {
                throw new Error("No Stability API keys found in environment variables. Please check Vercel settings.");
            }

            for (let i = 0; i < stabilityKeys.length; i++) {
                const key = stabilityKeys[i];
                try {
                    // Use FormData for Stability AI v2beta compatibility
                    const aiFormData = new FormData();
                    aiFormData.append("prompt", `${prompt}, high quality 360 degree equirectangular panorama, VR ready, seamless horizon`);
                    aiFormData.append("output_format", "webp");
                    aiFormData.append("aspect_ratio", "21:9"); // Closest to 2:1 pano

                    const response = await fetch("https://api.stability.ai/v2beta/stable-image/generate/ultra", {
                        method: "POST",
                        headers: {
                            "Authorization": `Bearer ${key}`,
                            "Accept": "application/json"
                        },
                        body: aiFormData
                    });

                    const data = await response.json();

                    if (!response.ok) {
                        console.error(`Stability AI Key ${i} error:`, data.message || response.statusText);
                        continue;
                    }

                    if (data.image) {
                        result = { image: `data:image/webp;base64,${data.image}`, method: "pure_ai" };
                        break;
                    }
                } catch (e: any) {
                    console.error(`AI Fallback Attempt ${i} failed:`, e.message);
                    continue;
                }
            }
        }

        if (!result) {
            throw new Error("Pipeline Exhausted: Both local CV stitching and cloud AI generation failed. Possible reasons: Invalid API Key or Out of Credits.");
        }

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
