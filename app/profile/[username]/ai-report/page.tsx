import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { getServerUser } from "@/lib/getServerUser"
import { getUserProfile } from "@/lib/api"
import AIReportPageClient from "@/components/ai-report-page-client"

export const metadata: Metadata = {
  title: "AI Report",
  description: "View your personalized AI-generated media taste report on MediaMatch.",
}

type Params = {
  username: string
}

export default async function AIReportPage({ params }: { params: Promise<Params> }) {
  const { username } = await params

  const user = await getServerUser()
  if (!user) redirect("/login")

  const profile = await getUserProfile(username)
  if (!profile) notFound()

  const serializedProfile = JSON.parse(JSON.stringify(profile))

  return <AIReportPageClient profile={serializedProfile} />
}
