/// <reference types="electron-vite/node" />
import type { Bridge } from './shared/bridge'

declare global {
  interface Window {
    mayorly?: Bridge
  }
}
