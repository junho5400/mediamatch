function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

// Server-side only env vars — accessed lazily to avoid build-time errors
export const env = {
  get FIREBASE_PROJECT_ID() { return requireEnv('FIREBASE_PROJECT_ID') },
  get FIREBASE_CLIENT_EMAIL() { return requireEnv('FIREBASE_CLIENT_EMAIL') },
  get FIREBASE_PRIVATE_KEY() { return requireEnv('FIREBASE_PRIVATE_KEY') },
  get GEMINI_API_KEY() { return requireEnv('GEMINI_API_KEY') },
  get GOOGLE_BOOKS_API_KEY() { return requireEnv('GOOGLE_BOOKS_API_KEY') },
  get TMDB_API_KEY() { return requireEnv('TMDB_API_KEY') },
}
