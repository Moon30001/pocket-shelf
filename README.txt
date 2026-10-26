POCKET SHELF: offline player for your own GBA / GB / GBC / DS ROMs
=====================================================================

What it does
- A library of your games (Emerald, FireRed, Black/White, Red and so on), each with its own save
- Plays fully offline once installed. No account, no login, no servers
- In-game saves are written to the device automatically (every 15 s, and whenever you leave,
  switch games or put the app in the background)
- Save states are in the emulator menu (☰ icon on the game screen)
- Export or import .sav files per game (⋯ on a game card), handy for moving saves between devices
- DS games: choose melonDS (more accurate) or DeSmuME (faster on weaker phones) per game

HOW TO INSTALL (one time, needs internet once)
A web app has to be opened from a web address once before the phone can install it.
Easiest free option is GitHub Pages:
  1. Create a new GitHub repository, e.g. "pocket-shelf"
  2. Unzip this file, then Add file → Upload files and select ALL 31 files (there are no subfolders)
  3. Repo Settings → Pages → Source: "Deploy from a branch" → main / root → Save
  4. Open https://<your-username>.github.io/pocket-shelf/ on your phone
  5. Wait for "Offline ready" (top right), then in Chrome's ⋮ menu tap "Add to Home screen" / "Install app"
From then on, open it from the home-screen icon, even in airplane mode.

Running it on a computer instead: in this folder run   python3 -m http.server 8000
and open http://localhost:8000 (opening index.html directly as a file will not work).

Notes
- Your ROMs and saves live inside the browser's storage on that device. Uninstalling the app or
  clearing Chrome's site data deletes them, so export important saves now and then.
- .zip ROMs are fine. Extract .7z/.rar first.
- Emulation: EmulatorJS 4.2.3 with mGBA, melonDS and DeSmuME cores (GPL). See data/LICENSE-EmulatorJS.txt.
