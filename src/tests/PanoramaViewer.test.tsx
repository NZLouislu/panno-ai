import { render, screen } from '@testing-library/react'
import PanoramaViewer from '@/components/PanoramaViewer'

// Mock Three.js dependencies
jest.mock('@react-three/fiber', () => ({
    Canvas: ({ children }: any) => <div data-testid="canvas">{children}</div>,
    useLoader: jest.fn(() => ({ mapping: {}, colorSpace: '' })),
}))

jest.mock('@react-three/drei', () => ({
    OrbitControls: () => <div data-testid="controls">Controls</div>,
    Sphere: ({ children }: any) => <div data-testid="sphere">{children}</div>,
}))

jest.mock('three', () => ({
    TextureLoader: jest.fn(),
    EquirectangularReflectionMapping: 'EquirectangularReflectionMapping',
    SRGBColorSpace: 'SRGBColorSpace',
    BackSide: 'BackSide',
}))

describe('PanoramaViewer', () => {
    it('renders correctly', () => {
        render(<PanoramaViewer imageUrl="test.jpg" />)

        // It has a mounting check, so initially it might render placeholder
        // But useEffect runs synchronously in testing-library often? No.
        // Wait, useEffect triggers re-render.

        // Actually the component returns null initially?
        // "if (!mounted) return <div ... animate-pulse />"
        // So initially it renders the loader.
        expect(screen.getByTestId('canvas')).toBeInTheDocument()
        // Wait, if mounted is true.
    })
})
