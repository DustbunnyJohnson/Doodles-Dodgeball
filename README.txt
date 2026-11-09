Doodles Stickman Dodgeball
==========================
Play locally (with online 1v1):
  1. Install Node.js (nodejs.org), version 16 or newer.
  2. In this folder run:  node server.js
  3. Open http://localhost:3000 in a browser.
  For friends over the internet, host this folder on any Node host (Render, Railway, Fly.io...)
  with the start command "node server.js". It uses the PORT the host provides.
  The game and its /ws relay must be served from the same address.

Solo vs AI and Hoops only: just open index.html (no server needed).

Needs an internet connection to load the three.js library from a CDN.
Catch: tap anywhere (or press Space/F/C) while an incoming ball has a gold outline. Works while holding a ball.
