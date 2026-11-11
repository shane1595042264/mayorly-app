import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'

// Speaking into the capture line (Dictation.swift). Every event carries the whole text heard so
// far, so the page shows it as it comes and keeps what was typed before the microphone opened.

interface DictationPlugin {
  start(): Promise<void>
  stop(): Promise<void>
  addListener(event: 'partial' | 'final', fn: (e: { text: string }) => void): Promise<PluginListenerHandle>
}
const Dictation = registerPlugin<DictationPlugin>('Dictation')

export const dictationAvailable = () => Capacitor.isPluginAvailable('Dictation')

/** Starts listening. `heard` gets the text so far on every change and once more, final, at the end. */
export async function listen(heard: (text: string, final: boolean) => void): Promise<() => Promise<void>> {
  const handles = await Promise.all([
    Dictation.addListener('partial', (e) => heard(e.text, false)),
    Dictation.addListener('final', (e) => {
      heard(e.text, true)
      void Promise.all(handles.map((h) => h.remove()))
    }),
  ])
  try {
    await Dictation.start()
  } catch (err) {
    await Promise.all(handles.map((h) => h.remove()))
    throw err
  }
  return () => Dictation.stop()
}
