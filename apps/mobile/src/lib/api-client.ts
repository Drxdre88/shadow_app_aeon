import { storage } from './storage'

const BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'https://aeon.app'
const API_PREFIX = '/api/v1'

class ApiClient {
  private baseUrl: string

  constructor() {
    this.baseUrl = `${BASE_URL}${API_PREFIX}`
  }

  async setToken(token: string): Promise<void> {
    await storage.setToken(token)
  }

  async clearToken(): Promise<void> {
    await storage.clearToken()
  }

  async hasToken(): Promise<boolean> {
    return storage.hasToken()
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const token = await storage.getToken()
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    }
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers,
    })

    if (response.status === 401) {
      await this.clearToken()
      throw new Error('Session expired')
    }

    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: 'Request failed' }))
      throw new Error(body.error || `HTTP ${response.status}`)
    }

    const json = await response.json()
    return json.data !== undefined ? json.data : json
  }

  async get<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'GET' })
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    })
  }

  async put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined,
    })
  }

  async patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: 'PATCH',
      body: body ? JSON.stringify(body) : undefined,
    })
  }

  async delete<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'DELETE' })
  }
}

export const apiClient = new ApiClient()
