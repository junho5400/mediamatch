import { adminAuth } from '@/lib/firebase-admin'

export interface AuthResult {
  userId: string
  email: string
}

export async function verifyAuth(req: Request): Promise<AuthResult> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    throw new AuthError('Missing or invalid Authorization header', 401)
  }

  const token = authHeader.split('Bearer ')[1]
  if (!token) {
    throw new AuthError('Missing token', 401)
  }

  try {
    const decoded = await adminAuth.verifyIdToken(token)
    return {
      userId: decoded.uid,
      email: decoded.email || '',
    }
  } catch {
    throw new AuthError('Invalid or expired token', 401)
  }
}

export class AuthError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'AuthError'
    this.status = status
  }
}
