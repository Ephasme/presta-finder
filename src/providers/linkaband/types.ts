import type { ArtistProfile } from "./normalize.js"
import type { ParsedProfilePage } from "../profile-page.js"

export interface ParsedLinkabandArtist {
  listing: ArtistProfile
  profilePage: ParsedProfilePage | null
}
