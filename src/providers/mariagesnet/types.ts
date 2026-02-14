import type { VendorProfile } from "./normalize.js"
import type { ParsedProfilePage } from "../profile-page.js"

export interface ParsedMariagesnetVendor {
  listing: VendorProfile
  profilePage: ParsedProfilePage | null
}
