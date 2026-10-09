import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type Bridge } from '../shared/bridge'

function sub<T>(channel: string, fn: (v: T) => void): () => void {
  const h = (_: IpcRendererEvent, v: T) => fn(v)
  ipcRenderer.on(channel, h)
  return () => ipcRenderer.off(channel, h)
}

const bridge: Bridge = {
  kind: 'electron',
  getState: () => ipcRenderer.invoke(IPC.getState),
  dispatch: (action) => void ipcRenderer.invoke(IPC.dispatch, action),
  onState: (fn) => sub(IPC.state, fn),
  onEvents: (fn) => sub(IPC.events, fn),
  onCommand: (fn) => sub(IPC.command, fn),
  setMode: (mode) => ipcRenderer.send(IPC.setMode, mode),
  setHit: (hit) => ipcRenderer.send(IPC.setHit, hit),
  onHotkeyFailures: (fn) => sub(IPC.hotkeyFailures, fn),
}

contextBridge.exposeInMainWorld('mayorly', bridge)
