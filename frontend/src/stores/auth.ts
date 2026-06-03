import { defineStore } from 'pinia'
import { getMe, login as loginApi, logout as logoutApi, type User } from '../api/auth'

export const useAuthStore = defineStore('auth', {
  state: () => ({
    user: undefined as User | undefined,
    initialized: false,
    loading: false
  }),
  actions: {
    async fetchMe() {
      if (this.initialized) return this.user
      this.loading = true
      try {
        const { user } = await getMe()
        this.user = user
        return user
      } finally {
        this.loading = false
        this.initialized = true
      }
    },
    async login(payload: { username: string; password: string }) {
      this.loading = true
      try {
        const { user } = await loginApi(payload)
        this.user = user
        this.initialized = true
        return user
      } finally {
        this.loading = false
      }
    },
    async logout() {
      await logoutApi().catch(() => undefined)
      this.user = undefined
      this.initialized = true
    }
  }
})
