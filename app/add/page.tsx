// app/add/page.tsx
import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { getServerUser } from "@/lib/getServerUser"
import AddMediaForm from "@/components/add-media-form"

export const metadata: Metadata = {
  title: "Log Media",
  description: "Log a book, movie, or TV series to your MediaMatch library and share your ratings and reviews.",
}

export default async function AddMediaPage() {
  const user = await getServerUser()

  if (!user) {
    redirect("/login")
  }

  return (
    <div className="container max-w-3xl py-10">
      <h1 className="text-3xl font-bold mb-8">Add to Your Library</h1>
      <AddMediaForm />
    </div>
  )
}