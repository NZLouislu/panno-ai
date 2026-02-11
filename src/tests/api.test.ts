import { POST } from '@/app/api/generate/route'

// Mock next/server
jest.mock('next/server', () => ({
    NextResponse: {
        json: (body: any, init?: any) => ({
            json: async () => body,
            status: init?.status || 200,
        }),
    },
}))

// Mock Gemini
jest.mock('@/lib/gemini', () => ({
    generateWithFallback: jest.fn().mockResolvedValue({
        url: 'https://r-interactive-media.s3.amazonaws.com/9/equirectangular.jpg',
        success: true
    }),
}))

const createMockRequest = (body: any) => ({
    formData: async () => ({
        get: (key: string) => body[key],
        getAll: (key: string) => body[key] ? [body[key]] : [],
    }),
}) as any

describe('Generate API', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        // Suppress console.error for expected error tests
        jest.spyOn(console, 'error').mockImplementation(() => { })
    })

    afterEach(() => {
        jest.restoreAllMocks()
    })

    it('returns success for valid request', async () => {
        const req = createMockRequest({ prompt: 'test prompt' })

        const response = await POST(req)
        const json = await response.json()

        expect(response.status).toBe(200)
        expect(json.success).toBe(true)
        expect(json.url).toContain('equirectangular.jpg')
    })

    it('returns 500 on failure', async () => {
        const { generateWithFallback } = require('@/lib/gemini')
        generateWithFallback.mockRejectedValueOnce(new Error('API Error'))

        const req = createMockRequest({ prompt: 'fail' })

        const response = await POST(req)
        const json = await response.json()

        expect(response.status).toBe(500)
        expect(json.error).toBe('API Error')
    })
})
