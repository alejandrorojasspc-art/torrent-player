const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const express = require('express');
const torrentStream = require('torrent-stream');
const fs = require('fs');

const CACHE_LIMIT_BYTES = 512 * 1024 * 1024; // Strict 512 MB
let engine = null;
let mpvProcess = null;

// Стриминговый сервер
const serverApp = express();
serverApp.get('/stream', (req, res) => {
  const magnet = req.query.magnet;
  if (!magnet) return res.status(400).send('No magnet provided');

  if (engine) engine.destroy();

  engine = torrentStream(magnet, {
    connections: 100,
    uploads: 0,
    tmp: path.join(app.getPath('userData'), 'torrent-cache'),
    buffer: CACHE_LIMIT_BYTES
  });

  engine.on('ready', () => {
    const file = engine.files.reduce((a, b) => (a.length > b.length ? a : b));
    const range = req.headers.range;

    if (!range) {
      res.writeHead(200, { 'Content-Length': file.length, 'Content-Type': 'video/mp4' });
      file.createReadStream().pipe(res);
      return;
    }

    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : file.length - 1;

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${file.length}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': (end - start) + 1,
      'Content-Type': 'video/mp4',
    });

    file.createReadStream({ start, end }).pipe(res);
  });
});
serverApp.listen(8888);

// Запуск MPV
ipcMain.on('play-magnet', (event, magnet) => {
  if (mpvProcess) mpvProcess.kill();

  const mpvExecutable = app.isPackaged
    ? path.join(process.resourcesPath, 'bin', 'mpv.exe')
    : path.join(__dirname, 'bin', 'mpv.exe');

  const streamUrl = `http://localhost:8888/stream?magnet=${encodeURIComponent(magnet)}`;

  mpvProcess = spawn(mpvExecutable, [
    streamUrl,
    '--force-window=yes',
    '--title=Fast Torrent Player',
    '--demuxer-max-bytes=512M',
    '--demuxer-max-back-bytes=100M',
    '--hwdec=auto'
  ]);
});

function createWindow() {
  const win = new BrowserWindow({
    width: 900,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  win.loadFile('index.html');
}

app.whenReady().then(createWindow);

app.on('will-quit', () => {
  const cacheDir = path.join(app.getPath('userData'), 'torrent-cache');
  if (fs.existsSync(cacheDir)) {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
});
