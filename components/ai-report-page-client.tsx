"use client"

import { useEffect, useState } from "react"
import { Loader2, AlertCircle, Dna } from "lucide-react"
import { auth } from "@/lib/firebase/firebase"
import { AIReport } from "@/types/ai-report"
import { UserProfile } from "@/types/database"
import AIReportView from "@/components/ai-report-view"
import { Button } from "@/components/ui/button"

type State =
  | { status: "loading" }
  | { status: "ready"; report: AIReport; cached: boolean }
  | { status: "error"; message: string; retryable: boolean }

export default function AIReportPageClient({ profile }: { profile: UserProfile }) {
  const [state, setState] = useState<State>({ status: "loading" })

  const load = async () => {
    setState({ status: "loading" })
    try {
      const token = await auth.currentUser?.getIdToken()
      if (!token) {
        setState({ status: "error", message: "You must be signed in.", retryable: false })
        return
      }

      const res = await fetch("/api/ai-report", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setState({
          status: "error",
          message: body?.error ?? `Request failed (${res.status})`,
          retryable: res.status === 429 || res.status >= 500,
        })
        return
      }

      const data = (await res.json()) as { report: AIReport; cached: boolean }
      setState({ status: "ready", report: data.report, cached: data.cached })
    } catch (err) {
      setState({
        status: "error",
        message: err instanceof Error ? err.message : "Something went wrong",
        retryable: true,
      })
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (state.status === "loading") {
    return (
      <div className="max-w-4xl mx-auto py-20 px-4 flex flex-col items-center justify-center text-center gap-4">
        <div className="h-12 w-12 rounded-full bg-primary/10 ring-1 ring-primary/30 flex items-center justify-center">
          <Dna className="h-6 w-6 text-primary animate-pulse" />
        </div>
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Analyzing your taste…</h2>
          <p className="text-sm text-muted-foreground flex items-center gap-2 justify-center">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> This takes a few seconds
          </p>
        </div>
      </div>
    )
  }

  if (state.status === "error") {
    return (
      <div className="max-w-xl mx-auto py-20 px-4 flex flex-col items-center text-center gap-4">
        <div className="h-12 w-12 rounded-full bg-destructive/10 ring-1 ring-destructive/30 flex items-center justify-center">
          <AlertCircle className="h-6 w-6 text-destructive" />
        </div>
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Couldn&apos;t generate your report</h2>
          <p className="text-sm text-muted-foreground">{state.message}</p>
        </div>
        {state.retryable && (
          <Button onClick={load} variant="outline" size="sm">
            Try again
          </Button>
        )}
      </div>
    )
  }

  return <AIReportView profile={profile} report={state.report} />
}
