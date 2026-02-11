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

        // 2. Call Python script with Fallback logic
        const stabilityKeys = [
            process.env.STABILITY_API_KEY,
            process.env.NZ_STABILITY_API_KEY
        ].filter(Boolean) as string[];

        let result = null;
        const pythonScript = path.join(process.cwd(), "scripts", "processor.py");
        const imageArgs = tempFiles.map(img => `"${img}"`).join(" ");

        for (let i = 0; i < stabilityKeys.length; i++) {
            const currentKey = stabilityKeys[i];
            try {
                const command = `python "${pythonScript}" "${currentKey}" "${prompt.replace(/"/g, '\\"')}" ${imageArgs}`;
                console.log(`Attempting hybrid pipeline with Stability Key ${i}...`);

                const { stdout, stderr } = await execAsync(command, { maxBuffer: 1024 * 1024 * 20 }); // 20MB
                if (stderr && !stdout) {
                    throw new Error(`Python stderr: ${stderr}`);
                }

                const parsed = JSON.parse(stdout);
                if (parsed.success) {
                    result = parsed;
                    break; // Success!
                } else {
                    console.warn(`Key ${i} failed: ${parsed.error}`);
                    if (i === stabilityKeys.length - 1) throw new Error(parsed.error);
                }
            } catch (err: any) {
                console.error(`Error with Stability Key ${i}:`, err.message);
                if (i === stabilityKeys.length - 1) throw err; // Re-throw if it's the last key
            }
        }

        if (!result) {
            throw new Error("All image processing attempts failed.");
        }

        return NextResponse.json({
            url: result.image,
            success: true,
            method: "cv_ai_hybrid"
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
