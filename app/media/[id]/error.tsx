"use client"

import { Button } from "@/components/ui/button"
import Link from "next/link"

export default function MediaError({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 text-center">
      <h2 className="text-2xl font-semibold">Failed to load media</h2>
      <p className="text-muted-foreground">Could not load this media. It may not exist or the service is temporarily unavailable.</p>
      <div className="flex gap-2">
        <Button onClick={reset}>Try again</Button>
        <Button variant="outline" asChild>
          <Link href="/">Go home</Link>
        </Button>
      </div>
    </div>
  )
}
