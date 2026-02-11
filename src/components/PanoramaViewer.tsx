"use client";

import { Canvas } from "@react-three/fiber";
import { OrbitControls, Sphere } from "@react-three/drei";
import * as THREE from "three";
import { Suspense, useEffect, useState } from "react";

function SkyBox({ imageUrl }: { imageUrl: string }) {
    const [texture, setTexture] = useState<THREE.Texture | null>(null);
    const [error, setError] = useState(false);

    useEffect(() => {
        if (!imageUrl ||
            imageUrl.includes("amazonaws.com") ||
            imageUrl.includes("wikimedia.org") ||
            imageUrl.includes("Mars_Rovers") ||
            imageUrl.includes("711.jpg")
        ) {
            setError(true);
            return;
        }

        const loader = new THREE.TextureLoader();
        loader.setCrossOrigin("anonymous");

        loader.load(
            imageUrl,
            (tex) => {
                tex.mapping = THREE.EquirectangularReflectionMapping;
                tex.colorSpace = THREE.SRGBColorSpace;
                setTexture(tex);
                setError(false);
            },
            undefined,
            (err) => {
                console.warn("Manual texture load failed, falling back:", imageUrl, err);
                setError(true);
            }
        );

        return () => {
            if (texture) texture.dispose();
        };
    }, [imageUrl]);

    return (
        <Sphere args={[500, 60, 40]} scale={[-1, 1, 1]}>
            {texture && !error ? (
                <meshBasicMaterial map={texture} side={THREE.BackSide} />
            ) : (
                <meshStandardMaterial
                    color="#0f172a"
                    side={THREE.BackSide}
                    roughness={0.1}
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
            <Canvas camera={{ position: [0, 0, 0.1] }}>
                <Suspense fallback={null}>
                    <ambientLight intensity={0.5} />
                    <pointLight position={[10, 10, 10]} />
                    <SkyBox imageUrl={imageUrl} />
                    <OrbitControls
                        enableZoom={true}
                        enablePan={false}
                        rotateSpeed={-0.5}
                        dampingFactor={0.05}
                        enableDamping={true}
                    />
                </Suspense>
            </Canvas>
        </div>
    );
}
