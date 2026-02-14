import type { UserProfile } from "./normalize.js"
import type { ParsedProfilePage } from "../profile-page.js"

export interface ParsedLiveTonightProfile {
  listing: UserProfile
  profilePage: ParsedProfilePage | null
}
