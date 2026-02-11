import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import Home from '@/app/page'

// Mock dependencies
jest.mock('next-auth/react', () => ({
    useSession: jest.fn(() => ({ data: null })),
    signIn: jest.fn(),
    signOut: jest.fn(),
}))

jest.mock('next/dynamic', () => () => {
    const DynamicComponent = () => <div>PanoramaViewer Mock</div>
    DynamicComponent.displayName = 'PanoramaViewer'
    return DynamicComponent
})

// Mock child components
jest.mock('@/components/Navbar', () => () => <div data-testid="navbar">Navbar</div>)
jest.mock('@/components/UploadSection', () => ({ onGenerate, isGenerating }: any) => (
    <div data-testid="upload-section">
        <button onClick={() => onGenerate('test prompt', [])} disabled={isGenerating}>Generate</button>
    </div>
))

describe('Home Page', () => {
    beforeEach(() => {
        localStorage.clear()
        jest.clearAllMocks()
        jest.useFakeTimers()
    })

    afterEach(() => {
        jest.useRealTimers()
    })

    it('renders initial state correctly', () => {
        render(<Home />)
        expect(screen.getByTestId('navbar')).toBeInTheDocument()
        expect(screen.getByTestId('upload-section')).toBeInTheDocument()
        expect(screen.getByText('No panoramas yet')).toBeInTheDocument()
        expect(screen.getByText('Your Gallery')).toBeInTheDocument()
        expect(screen.getByText('0 Creations')).toBeInTheDocument()
    })

    it('generates panorama successfully', async () => {
        render(<Home />)

        const generateBtn = screen.getByText('Generate')

        await act(async () => {
            fireEvent.click(generateBtn)
            jest.advanceTimersByTime(3500)
        })

        // Wait for update
        await waitFor(() => {
            expect(screen.queryByText('Generating...')).not.toBeInTheDocument()
        })

        expect(await screen.findByText('PanoramaViewer Mock')).toBeInTheDocument()
        expect(screen.getByText('1 Creations')).toBeInTheDocument()
    })

    it('loads history from localStorage', async () => {
        const mockHistory = [{
            id: 'test-id',
            url: 'http://test.url/pano.jpg',
            prompt: 'test prompt',
            timestamp: new Date().toISOString()
        }]
        localStorage.setItem('pano-history', JSON.stringify(mockHistory))

        render(<Home />)

        // We expect 1 creation immediately
        expect(await screen.findByText('1 Creations')).toBeInTheDocument()
        expect(screen.getByText('PanoramaViewer Mock')).toBeInTheDocument()
    })
})
