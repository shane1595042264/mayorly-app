import {
  Barbell, BookOpen, Briefcase, Code, Crosshair, Flask, GameController, Globe, Heart, House,
  MusicNotes, PaintBrush, PenNib, PersonSimpleRun, Scales, type Icon,
} from '@phosphor-icons/react'
import type { GlyphName } from '@core/index'

export const GLYPHS: Record<GlyphName, Icon> = {
  scales: Scales,
  music: MusicNotes,
  briefcase: Briefcase,
  book: BookOpen,
  code: Code,
  barbell: Barbell,
  pen: PenNib,
  house: House,
  heart: Heart,
  flask: Flask,
  globe: Globe,
  paint: PaintBrush,
  run: PersonSimpleRun,
  game: GameController,
}

export function Glyph({ name, size = 16 }: { name: GlyphName | undefined; size?: number }) {
  const G = (name && GLYPHS[name]) || Crosshair
  return <G size={size} weight="light" aria-hidden />
}
