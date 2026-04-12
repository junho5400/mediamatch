// app/page.tsx
import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { getServerUser } from "@/lib/getServerUser"
import HomeFeed from "@/components/home-feed"

export const metadata: Metadata = {
  title: "Home",
  description: "Discover and log your favorite books, movies, and TV series with AI-powered recommendations on MediaMatch.",
}

export default async function Home() {
  const user = await getServerUser()

  if (!user) {
    redirect("/login")
  }

  return <HomeFeed />
}