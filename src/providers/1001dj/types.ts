import type { ItemListEntry } from "./normalize.js"
import type { ProfilePageDetails } from "./parse-profile.js"

export interface Parsed1001DjProfile {
  listing: ItemListEntry
  profilePage: ProfilePageDetails | null
}
