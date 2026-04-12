"use client"

import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { BookOpen, Sparkles, BarChart2, MessageSquare, PlusCircle } from "lucide-react"

interface OnboardingProps {
  displayName?: string | null
}

export default function Onboarding({ displayName }: OnboardingProps) {
  const firstName = displayName?.split(" ")[0] || "there"

  return (
    <div className="container py-16 max-w-2xl mx-auto flex flex-col items-center gap-8">
      {/* Welcome header */}
      <div className="text-center space-y-3">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 mb-2">
          <BookOpen className="h-8 w-8 text-white" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 text-transparent bg-clip-text">
          Welcome, {firstName}!
        </h1>
        <p className="text-muted-foreground text-base max-w-md mx-auto">
          MediaMatch is your personal library for books, movies, and TV shows — powered by AI to help you discover what to watch or read next.
        </p>
      </div>

      {/* CTA */}
      <Button asChild size="lg" className="bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 text-white shadow-md px-8 py-6 text-base rounded-full">
        <Link href="/add">
          <PlusCircle className="mr-2 h-5 w-5" />
          Log your first item
        </Link>
      </Button>

      {/* AI features unlock card */}
      <Card className="w-full border border-border/50 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-purple-500" />
            AI features unlock as you log media
          </CardTitle>
          <CardDescription>Add at least one item to your library to get started.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
          <div className="flex flex-col items-center text-center gap-2 p-3 rounded-lg bg-muted/40">
            <Sparkles className="h-6 w-6 text-indigo-500" />
            <p className="text-sm font-medium">AI Recommendations</p>
            <p className="text-xs text-muted-foreground">Personalized picks based on your taste</p>
          </div>
          <div className="flex flex-col items-center text-center gap-2 p-3 rounded-lg bg-muted/40">
            <BarChart2 className="h-6 w-6 text-purple-500" />
            <p className="text-sm font-medium">Taste Report</p>
            <p className="text-xs text-muted-foreground">A deep-dive analysis of your media habits</p>
          </div>
          <div className="flex flex-col items-center text-center gap-2 p-3 rounded-lg bg-muted/40">
            <MessageSquare className="h-6 w-6 text-pink-500" />
            <p className="text-sm font-medium">AI Chatbot</p>
            <p className="text-xs text-muted-foreground">Ask for recommendations and get instant answers</p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
