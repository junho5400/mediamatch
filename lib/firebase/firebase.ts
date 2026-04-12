import { initializeApp, getApp, getApps } from 'firebase/app'
import { getFirestore, doc, setDoc } from 'firebase/firestore'
import { getAuth, GoogleAuthProvider, signInWithPopup, User, signOut as firebaseSignOut } from 'firebase/auth'
import { removeUndefinedFields } from "@/lib/utils"

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
}

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp()

export const db = getFirestore(app)
export const auth = getAuth(app)
export const googleProvider = new GoogleAuthProvider()

export const signInWithGoogle = async () => {
  const result = await signInWithPopup(auth, googleProvider)
  const idToken = await result.user.getIdToken(true)
  await createSession(idToken)
  await saveUserToFirestore(result.user)
  return result.user
}

const createSession = async (idToken: string) => {
  const response = await fetch('/api/auth/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
  })

  if (!response.ok) throw new Error('Failed to create session')
}

export const saveUserToFirestore = async (user: User) => {
  if (!user.uid) return

  const userData = removeUndefinedFields({
    uid: user.uid,
    email: user.email || null,
    displayName: user.displayName || user.email?.split('@')[0] || 'User',
    photoURL: user.photoURL || null,
    createdAt: new Date(),
    isAuthenticated: true,
  })

  const userRef = doc(db, 'users', user.uid)
  await setDoc(userRef, userData, { merge: true })
}

export const signOut = async () => {
  await firebaseSignOut(auth)
  await fetch('/api/auth/session', { method: 'DELETE' })
}
