import { adminDb } from "@/lib/firebase-admin"
import { MediaEntry, MediaType } from "@/types/database"

/**
 * Server-only version of getUserMediaEntries.
 *
 * The client-SDK version in ./firestore.ts runs on the browser under the
 * user's auth context, so Firestore rules (`request.auth.uid == userId`)
 * pass. From a Next.js API route the client SDK has no auth context, so
 * rules deny every read and return empty. Server code must use the Admin
 * SDK, which bypasses rules.
 */
export async function getUserMediaEntriesAdmin(
  userId: string,
  mediaType?: MediaType
): Promise<Array<{ id: string; mediaId: string; type: MediaType } & MediaEntry>> {
  const entries: Array<{ id: string; mediaId: string; type: MediaType } & MediaEntry> = []
  const typesToQuery: MediaType[] = mediaType ? [mediaType] : ["movie", "tv", "book"]

  for (const type of typesToQuery) {
    const snapshot = await adminDb
      .collection("users").doc(userId)
      .collection("library").doc(type)
      .collection("entries")
      .get()

    for (const doc of snapshot.docs) {
      const data = doc.data() as MediaEntry
      entries.push({
        id: doc.id,
        ...data,
        mediaId: data.mediaId,
        type,
      })
    }
  }

  entries.sort((a, b) => {
    const toMs = (v: unknown): number => {
      if (!v) return 0
      if (v instanceof Date) return v.getTime()
      if (typeof v === "object" && v !== null && "toDate" in v) {
        return (v as { toDate: () => Date }).toDate().getTime()
      }
      if (typeof v === "object" && v !== null && "_seconds" in v) {
        return (v as { _seconds: number })._seconds * 1000
      }
      return 0
    }
    return toMs(b.watchedAt) - toMs(a.watchedAt)
  })

  return entries
}
