Doodles Stickman Dodgeball
==========================
Play locally (with online play for up to 6 players):
  1. Install Node.js (nodejs.org), version 16 or newer.
  2. In this folder run:  node server.js
  3. Open http://localhost:3000 in a browser.
  For friends over the internet, host this folder on any Node host (Render, Railway, Fly.io...)
  with the start command "node server.js". Only index.html and server.js are needed.
  The game and its /ws relay must be served from the same address.

Solo vs bots (1v1, 2v2, 3v3) and Hoops: just open index.html (no server needed).

Needs an internet connection to load the three.js library from a CDN.

Controls
  Move: WASD / arrows (or the pad on a phone)    Dash: Shift / DASH button
  Jump: Space / JUMP button                       Catch: tap anywhere (or F / C) while a ball is gold-outlined
  Pick up: tap a ball (or E). Dead balls (touched floor or wall) can be grabbed by tapping them directly.
  Throw: swipe up and release ON the target.
Team games: knock out the whole other team to win a round. A glowing hole slides along the far wall:
  land a ball in it to revive a knocked-out teammate.
