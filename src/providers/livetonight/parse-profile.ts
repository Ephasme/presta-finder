import { parseGenericProfilePage, type ParsedProfilePage } from "../profile-page.js"

export const parseLiveTonightProfilePage = (html: string): ParsedProfilePage =>
  parseGenericProfilePage(html, [".artist-description", ".musician-description", ".description", "main"])
