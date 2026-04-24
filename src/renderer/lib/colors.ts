/**
 * Design tokens. Mirror finbro.me's palette:
 *  - Pure white surfaces (no warm tints)
 *  - Tailwind-aligned neutral gray scale (matches what finbro.me components
 *    actually reach for — `bg-gray-100`, `border-gray-300`, `text-gray-500`)
 *  - Single primary accent (#290E99) reserved for "act now" signals
 *  - Semantic colors used only on small marks / icons
 *
 * No product-specific names ("brand", "finbroPurple") in identifiers; the
 * hex for `primary` happens to match the product accent but the code
 * references it by role, not by product.
 *
 * Renderer components should read from CSS variables in styles.css by
 * default; this module exists for the rare cases where a value has to be
 * passed to JS (inline styles, animation colors).
 */

export const colors = {
  // Accent
  primary:       '#290E99',
  primarySoft:   'rgba(41, 14, 153, 0.08)',
  primaryHover:  'rgba(41, 14, 153, 0.14)',

  // Neutrals (Tailwind gray-N, matching finbro.me usage)
  white:         '#FFFFFF',
  gray50:        '#F9FAFB',
  gray100:       '#F3F4F6',   // hover / active row background
  gray200:       '#E5E7EB',
  gray300:       '#D1D5DB',   // borders
  gray400:       '#9CA3AF',   // disabled glyphs
  gray500:       '#6B7280',   // group titles, muted text
  gray600:       '#4B5563',
  gray700:       '#374151',   // inactive nav text
  gray800:       '#1F2937',
  gray900:       '#111827',   // primary text, active nav text

  // Semantic (used on marks only, never full backgrounds)
  success:       '#10B981',
  warning:       '#F59E0B',
  danger:        '#EF4444',
} as const;

export type ColorToken = keyof typeof colors;
