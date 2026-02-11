"use client";

import { Canvas } from "@react-three/fiber";
import { OrbitControls, Sphere } from "@react-three/drei";
import * as THREE from "three";
import { Suspense, useEffect, useState } from "react";

function SkyBox({ imageUrl }: { imageUrl: string }) {
    const [texture, setTexture] = useState<THREE.Texture | null>(null);
    const [error, setError] = useState(false);

    useEffect(() => {
        if (!imageUrl) {
            setError(true);
            return;
        }

        const loader = new THREE.TextureLoader();
        loader.setCrossOrigin("anonymous");

        console.log("Loading panorama texture:", imageUrl);

        loader.load(
            imageUrl,
            (tex) => {
                tex.colorSpace = THREE.SRGBColorSpace;
                setTexture(tex);
                setError(false);
                console.log("Texture loaded successfully");
            },
            undefined,
            (err) => {
                console.error("Texture load error for:", imageUrl, err);
                setError(true);
            }
        );

        return () => {
            if (texture) texture.dispose();
        };
    }, [imageUrl]);

    return (
        <Sphere args={[15, 64, 32]} scale={[-1, 1, 1]}>
            {texture && !error ? (
                <meshBasicMaterial map={texture} side={THREE.BackSide} />
            ) : (
                <meshStandardMaterial
                    color="#1e293b" // Slate 800 - clearly not pitch black
                    side={THREE.BackSide}
                    roughness={0.8}
                    metalness={0.2}
                />
            )}
        </Sphere>
    );
}

export default function PanoramaViewer({ imageUrl }: { imageUrl: string }) {
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    if (!mounted) return <div className="w-full h-full bg-slate-900 animate-pulse" />;

    return (
        <div className="w-full h-full rounded-2xl overflow-hidden glass border border-white/20">
            <Canvas camera={{ position: [0, 0, 0.1], fov: 75 }}>
                <Suspense fallback={null}>
                    {/* Brighter lights for fallback material visibility */}
                    <ambientLight intensity={1.5} />
                    <pointLight position={[5, 5, 5]} intensity={2} />
                    <SkyBox imageUrl={imageUrl} />
                    <OrbitControls
                        enableZoom={true}
                        enablePan={false}
                        rotateSpeed={-0.3}
                        dampingFactor={0.1}
                        enableDamping={true}
                        autoRotate={true}
                        autoRotateSpeed={0.5}
                    />
                </Suspense>
            </Canvas>
        </div>
    );
}
