# FSGC Word Cloud Live

Platformă live tip Mentimeter pentru „Săptămâna Europeană”.

## Pornire

```powershell
npm.cmd start
```

După pornire:

- prezentare: http://localhost:3000/
- participanți: http://localhost:3000/join
- administrare: http://localhost:3000/admin

Pe ecranul de prezentare apare automat și linkul de rețea locală, plus cod QR, dacă laptopul este conectat la Wi-Fi.

## Ce face

- primește răspunsuri live prin Socket.IO;
- salvează fiecare răspuns în `data/responses.json`;
- afișează cloud SVG cu `d3-cloud`, cu layout stabil și recalculare automată;
- păstrează top 400 cuvinte unice vizibile, pentru lizibilitate;
- include export CSV/JSON, pauză colectare, demo și ștergere din admin.

## GitHub și deploy

GitHub Pages nu este potrivit pentru versiunea completă, fiindcă aplicația are server Node, Socket.IO și salvare de date. Pune codul pe GitHub ca repository, apoi fă deploy pe un serviciu care rulează procese Node permanente, cum ar fi Render sau Railway.

### Ce urci pe GitHub

Urcă aceste fișiere/directoare:

- `server.js`
- `package.json`
- `package-lock.json`
- `public/`
- `README.md`
- `.gitignore`

Nu urca `node_modules/` și nu urca răspunsurile reale din `data/responses.json`.

### Setări recomandate pe Render

- Service type: `Web Service`
- Runtime: `Node`
- Build command: `npm install`
- Start command: `npm start`
- Branch: `main`

Serverul folosește automat variabila `PORT` oferită de platformă și ascultă pe `0.0.0.0`, deci este pregătit pentru deploy.

Pentru ca răspunsurile să nu se piardă la restart/redeploy, adaugă un Persistent Disk și setează variabila:

```text
DATA_DIR=/var/data
```

Mount path pentru disk:

```text
/var/data
```

Dacă nu ai atașat încă disk-ul, nu seta `DATA_DIR`. Platforma va porni, dar răspunsurile pot fi temporare și se pot pierde la restart/redeploy.
