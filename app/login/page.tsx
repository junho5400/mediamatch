// app/login/page.tsx
import type { Metadata } from "next"
import { redirect } from "next/navigation"
import LoginForm from "@/components/login-form"
import { cookies } from "next/headers"
import { adminAuth } from "@/lib/firebase-admin"

export const metadata: Metadata = {
  title: "Sign In",
  description: "Sign in to MediaMatch to track your media library and get personalized AI-powered recommendations.",
}

export default async function LoginPage() {
  try {
    // Check if user is already logged in
    const cookieStore = await cookies()
    const sessionCookie = cookieStore.get('session')?.value
    
    if (sessionCookie) {
      // Verify the session cookie
      try {
        await adminAuth.verifySessionCookie(sessionCookie, true)
        // User is logged in, redirect to home
        redirect("/")
      } catch (error) {
        // Invalid session cookie, continue to login page
      }
    }
  } catch (error) {
    // Error checking session, continue to login page
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-xs space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">MediaMatch</h1>
          <p className="text-sm text-muted-foreground">
            Discover movies, shows, and books you&apos;ll love.
          </p>
        </div>
        <LoginForm />
      </div>
    </div>
  )
}