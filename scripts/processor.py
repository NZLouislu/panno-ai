import cv2
import numpy as np
import base64
import requests
import sys
import os
import json

class PanoEngine:
    def __init__(self, api_key):
        self.api_key = api_key
        # 创建拼接器，全景模式
        self.stitcher = cv2.Stitcher_create(cv2.Stitcher_PANORAMA)

    def stitch_and_generate_mask(self, image_paths):
        """1. 使用 OpenCV 拼接并生成掩码"""
        imgs = []
        for p in image_paths:
            img = cv2.imread(p)
            if img is not None:
                imgs.append(img)
        
        if len(imgs) < 1:
            raise Exception("No valid images found for stitching.")

        if len(imgs) == 1:
            # 只有一张图时，直接作为基础图
            pano = imgs[0]
        else:
            # 拼接
            status, pano = self.stitcher.stitch(imgs)
            if status != cv2.Stitcher_OK:
                # 如果拼接失败，回退到第一张图
                pano = imgs[0]

        # 强制调整为 2:1 比例用于 360 度显示 (Equirectangular)
        h, w = pano.shape[:2]
        target_w = w
        target_h = int(w / 2)
        
        # 创建画布，居中填充
        canvas = np.zeros((target_h, target_w, 3), dtype=np.uint8)
        y_offset = (target_h - h) // 2
        
        # 将拼接后的图放入 2:1 画布中央
        if y_offset >= 0:
            canvas[y_offset:y_offset+h, 0:w] = pano
        else:
            # 如果拼接出来的图特别高，进行截取
            canvas[0:target_h, 0:w] = pano[-y_offset:-y_offset+target_h, :]

        # 生成 Mask (黑色区域为 0,0,0)
        gray = cv2.cvtColor(canvas, cv2.COLOR_BGR2GRAY)
        _, mask = cv2.threshold(gray, 1, 255, cv2.THRESH_BINARY_INV)
        
        # 膨胀掩码以防止接缝黑线
        kernel = np.ones((15, 15), np.uint8)
        mask = cv2.dilate(mask, kernel, iterations=1)
        
        return canvas, mask

    def stability_inpaint(self, image, mask, prompt):
        """2. Stability AI v2beta Inpaint API"""
        url = "https://api.stability.ai/v2beta/stable-image/edit/inpaint"
        
        _, img_encoded = cv2.imencode(".png", image)
        _, mask_encoded = cv2.imencode(".png", mask)

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Accept": "image/*"
        }

        files = {
            "image": ("image.png", img_encoded.tobytes(), "image/png"),
            "mask": ("mask.png", mask_encoded.tobytes(), "image/png"),
        }

        data = {
            "prompt": f"{prompt}, photorealistic 360 panorama, wide angle, immersive view, seamless texture",
            "output_format": "png",
        }

        response = requests.post(url, headers=headers, files=files, data=data)
        
        if response.status_code != 200:
            raise Exception(f"Stability API Error ({response.status_code}): {response.text}")

        result_base64 = base64.b64encode(response.content).decode('utf-8')
        return result_base64


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(json.dumps({"success": False, "error": "Insufficient arguments"}))
        sys.exit(1)

    api_key = sys.argv[1]
    prompt = sys.argv[2]
    img_paths = sys.argv[3:]

    try:
        engine = PanoEngine(api_key)
        # 某些环境可能没有安装 OpenCV 拼接插件，做个兼容
        pano, mask = engine.stitch_and_generate_mask(img_paths)
        
        # 如果没有配置 API key，仅返回拼接结果（开发者调试用）
        if not api_key or api_key == "undefined":
            _, final_encoded = cv2.imencode(".png", pano)
            res_base64 = base64.b64encode(final_encoded).decode('utf-8')
            print(json.dumps({"success": True, "image": f"data:image/png;base64,{res_base64}", "note": "Stitched only, no AI"}))
        else:
            res_base64 = engine.stability_inpaint(pano, mask, prompt)
            print(json.dumps({"success": True, "image": f"data:image/png;base64,{res_base64}"}))
            
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
