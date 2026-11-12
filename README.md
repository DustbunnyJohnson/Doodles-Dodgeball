# Stickman Dodgeball

`index.html` is the whole game. `server.js` serves it and runs online play (rooms, 4-letter codes).
No packages to install.

## Run it on your computer
    node server.js
Open http://localhost:3000

## Put it on Render (from GitHub)
1. Put these files in a GitHub repo: index.html, server.js, package.json.
2. On Render: New > Web Service > pick the repo.
3. Runtime: Node. Build command: leave blank (or `npm install`). Start command: `npm start`.
4. Deploy, then open the Render URL. Online play works from that same address.

Solo play against bots works from any host. Online play needs this server.
