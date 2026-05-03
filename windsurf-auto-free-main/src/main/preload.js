const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  listAccounts: () => ipcRenderer.invoke('accounts:list'),
  getAccountsOverview: () => ipcRenderer.invoke('accounts:overview'),
  addAccount: (data) => ipcRenderer.invoke('accounts:add', data),
  deleteAccount: (id) => ipcRenderer.invoke('accounts:delete', id),
  deleteAllAccounts: () => ipcRenderer.invoke('accounts:deleteAll'),
  refreshAccount: (id) => ipcRenderer.invoke('accounts:refresh', id),
  refreshAllAccounts: () => ipcRenderer.invoke('accounts:refreshAll'),
  importAccounts: (text) => ipcRenderer.invoke('accounts:import', text),
  importFile: () => ipcRenderer.invoke('accounts:importFile'),
  exportAccounts: () => ipcRenderer.invoke('accounts:export'),
  checkStatus: (id) => ipcRenderer.invoke('accounts:checkStatus', id),
  switchAccount: (id) => ipcRenderer.invoke('accounts:switch', id),
  getProxyStatus: () => ipcRenderer.invoke('proxy:getStatus'),
  isAdmin: () => ipcRenderer.invoke('app:isAdmin'),
  onLog: (callback) => ipcRenderer.on('console-log', (_, msg) => callback(msg)),
});
