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
  dispatch: (action) => ipcRenderer.invoke(IPC.dispatch, action),
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
  deleteAccount: () => ipcRenderer.invoke(IPC.deleteAccount),
  signOutEverywhere: () => ipcRenderer.invoke(IPC.signOutEverywhere),
  log: (level, message) => ipcRenderer.send(IPC.log, level, message),
  getInfo: () => ipcRenderer.invoke(IPC.getInfo),
  getBuild: () => ipcRenderer.invoke(IPC.getBuild),
  whatsNew: () => ipcRenderer.invoke(IPC.whatsNew),
  seenBuild: () => ipcRenderer.send(IPC.seenBuild),
  exportState: () => ipcRenderer.invoke(IPC.exportState),
  importState: () => ipcRenderer.invoke(IPC.importState),
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
    pickGlyph: (name, criterion, options, taken) => ipcRenderer.invoke(IPC.aiPickGlyph, name, criterion, options, taken),
  },
  onAi: (fn) => sub(IPC.ai, fn),
  onClerk: (fn) => sub(IPC.clerk, fn),
  onClerkAsk: (fn) => sub(IPC.clerkAsk, fn),
  setMoving: (on) => ipcRenderer.send(IPC.moving, on),
  nudge: (dx, dy) => ipcRenderer.send(IPC.nudge, dx, dy),
  snap: (corner) => ipcRenderer.send(IPC.snap, corner),
  onEffect: (fn) => sub(IPC.effect, fn),
  effectDone: () => ipcRenderer.send(IPC.effectDone),
  closeDrawer: () => ipcRenderer.send(IPC.drawerClose),
  onHotkeyFailures: (fn) => sub(IPC.hotkeyFailures, fn),
}

contextBridge.exposeInMainWorld('mayorly', bridge)
