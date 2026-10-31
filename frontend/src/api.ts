export type SavedPiece = {
  name: string
  originalImageId: string
  cutoutImageId: string | null
  shown: 'original' | 'cutout'
  x: number
  y: number
  width: number
  ratio: number
}

export type Composition = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  pieces: SavedPiece[]
}

export type CompositionInput = { title: string; pieces: SavedPiece[] }

export class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export const imageUrl = (id: string) => `/api/images/${id}`

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init)
  if (!response.ok) {
    // Spring returns RFC 9457 problem details; show its detail when present.
    let message = `The backend returned HTTP ${response.status}.`
    try {
      const problem: unknown = await response.json()
      if (problem && typeof problem === 'object' && 'detail' in problem && typeof problem.detail === 'string') message = problem.detail
    } catch { /* not JSON */ }
    throw new ApiError(response.status, message)
  }
  return response.status === 204 ? undefined as T : await response.json() as T
}

export async function uploadImage(image: Blob): Promise<string> {
  const saved = await request<{ id: string }>('/api/images', {
    method: 'POST',
    headers: { 'Content-Type': image.type || 'application/octet-stream' },
    body: image,
  })
  return saved.id
}

const json = (method: string, body: unknown): RequestInit =>
  ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

export const listCompositions = (signal?: AbortSignal) => request<Composition[]>('/api/compositions', { signal })
export const createComposition = (input: CompositionInput) => request<Composition>('/api/compositions', json('POST', input))
export const updateComposition = (id: string, input: CompositionInput) => request<Composition>(`/api/compositions/${id}`, json('PUT', input))
export const deleteComposition = (id: string) => request<void>(`/api/compositions/${id}`, { method: 'DELETE' })
