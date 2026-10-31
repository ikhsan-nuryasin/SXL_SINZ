'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sxlDesktop', {
  getStartupSettings: () => ipcRenderer.invoke('desktop-startup:get'),
  setStartupOnLogin: enabled => ipcRenderer.invoke('desktop-startup:set', enabled),
  openSqlTerminal: () => ipcRenderer.invoke('desktop-sql-terminal:open')
});
