import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, DEFAULT_HOTKEYS, type Settings } from '@core/index'
import { describeTip, pressesTip, tip } from './tips'

const settings: Settings = { ...DEFAULT_SETTINGS, hotkeys: { ...DEFAULT_HOTKEYS } }
const el = (attrs: Record<string, string>) => {
  const dataset: Record<string, string> = {}
  for (const [k, v] of Object.entries(attrs)) dataset[k.replace(/^data-/, '').replace(/-(\w)/g, (_, c: string) => c.toUpperCase())] = v
  return { dataset } as unknown as HTMLElement
}
const key = (k: string, more: Partial<KeyboardEvent> = {}) => ({ key: k, code: '', shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...more }) as KeyboardEvent

describe('tips', () => {
  it('names the key a control also does, as bound now', () => {
    expect(describeTip(el(tip('deck.tab', 'open Shelf', '3')), settings)).toMatchObject({ keys: ['3'], does: 'open Shelf', hotkey: null })
    expect(describeTip(el(tip('deck.close')), settings)).toMatchObject({ does: 'close the deck', raw: ['Escape'] })
    const changed = { ...settings, keymap: { ...settings.keymap, 'deck.nextTab': ['l'] } }
    expect(describeTip(el(tip('deck.nextTab')), changed)?.raw).toEqual(['l'])
  })

  it('a global hotkey shows as its accelerator, and is known as one', () => {
    expect(describeTip(el(tip('hotkey:plus', 'open the swap menu')), settings)).toMatchObject({ raw: ['Alt+T'], hotkey: 'plus', does: 'open the swap menu' })
  })

  it('names nothing for an id it does not know', () => {
    expect(describeTip(el(tip('no.such.key')), settings)).toBeNull()
  })

  it('knows the key the tip asked for when it is pressed', () => {
    expect(pressesTip(key('3'), ['3'])).toBe(true)
    expect(pressesTip(key('4'), ['3'])).toBe(false)
    expect(pressesTip(key('Enter'), ['Enter'])).toBe(true)
    expect(pressesTip(key('Enter', { shiftKey: true }), ['Enter'])).toBe(false)
    expect(pressesTip(key('Enter', { shiftKey: true }), ['Shift+Enter'])).toBe(true)
    expect(pressesTip(key('G', { shiftKey: true }), ['G'])).toBe(true)
    expect(pressesTip(key('g'), ['G'])).toBe(false)
    expect(pressesTip(key('k'), ['j', 'k'])).toBe(true)
  })

  it('force mode, tips and the key echo are on by default, each on its own key', () => {
    expect(settings.tips).toEqual({ on: true, force: true, echo: true })
    expect(settings.hotkeys.tipsForce).toBe('Ctrl+Alt+.')
    expect(settings.hotkeys.tips).toBe('Ctrl+Alt+,')
  })
})
