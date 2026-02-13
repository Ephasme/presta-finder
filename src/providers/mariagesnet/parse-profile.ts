import { parseGenericProfilePage, type ParsedProfilePage } from "../profile-page.js"

export const parseMariagesnetProfilePage = (html: string): ParsedProfilePage =>
  parseGenericProfilePage(html, [".storefront-description", ".vendor-description", ".description", "main"])
