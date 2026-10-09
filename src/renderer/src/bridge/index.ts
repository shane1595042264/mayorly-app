import type { Bridge } from '../../../shared/bridge'
import { createWebBridge } from './web'

export const bridge: Bridge = window.mayorly ?? createWebBridge()
