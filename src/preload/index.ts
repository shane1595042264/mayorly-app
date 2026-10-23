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
  getLayout: () => ipcRenderer.invoke(IPC.getLayout),
  setCaption: (text) => ipcRenderer.send(IPC.setCaption, text),
  onCaption: (fn) => sub(IPC.caption, fn),
  onLayout: (fn) => sub(IPC.layout, fn),
  accountsAvailable: () => ipcRenderer.invoke(IPC.accountsAvailable),
  getAccount: () => ipcRenderer.invoke(IPC.getAccount),
  signIn: () => ipcRenderer.invoke(IPC.signIn),
  signOut: () => ipcRenderer.invoke(IPC.signOut),
  onAccount: (fn) => sub(IPC.account, fn),
  onSync: (fn) => sub(IPC.sync, fn),
  ai: {
    get: () => ipcRenderer.invoke(IPC.aiGet),
    addKey: (key) => ipcRenderer.invoke(IPC.aiAddKey, key),
    removeKey: (id) => ipcRenderer.invoke(IPC.aiRemoveKey, id),
    recheckKey: (id) => ipcRenderer.invoke(IPC.aiRecheckKey, id),
    setPreferredModel: (id, model) => ipcRenderer.invoke(IPC.aiPreferredModel, id, model),
    setPreferredProvider: (provider) => ipcRenderer.invoke(IPC.aiPreferredProvider, provider),
    sweepTray: () => ipcRenderer.invoke(IPC.aiSweep),
  },
  onAi: (fn) => sub(IPC.ai, fn),
  onClerk: (fn) => sub(IPC.clerk, fn),
  onClerkAsk: (fn) => sub(IPC.clerkAsk, fn),
  onHotkeyFailures: (fn) => sub(IPC.hotkeyFailures, fn),
}

contextBridge.exposeInMainWorld('mayorly', bridge)
