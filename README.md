# COCAINE® — Sito Streetwear

Sito e-commerce frontend per il brand COCAINE®. Tutto vanilla (HTML/CSS/JS), zero dipendenze, zero build step.

## Struttura

```
cocaine/
├── index.html       ← struttura HTML
├── style.css        ← tutti gli stili
├── app.js           ← tutto il JavaScript (routing, carrello, checkout, admin)
└── images/
    ├── hoodie-01.png
    ├── hoodie-02.png
    ├── hoodie-03.png
    └── hoodie-04.png
```

## Come testarlo in locale

**Importante**: NON aprire `index.html` con doppio click. I browser bloccano alcune funzionalità (fetch, localStorage in alcuni casi) quando il file è caricato dal filesystem.

Usa un mini-server locale. Le opzioni più semplici:

### Opzione A — Python (già installato su Mac/Linux)
Apri il terminale nella cartella e:
```bash
python3 -m http.server 8000
```
Poi vai su http://localhost:8000

### Opzione B — VS Code Live Server
Installa l'estensione "Live Server" → click destro su `index.html` → "Open with Live Server"

### Opzione C — Caricalo su GitHub Pages (vedi sotto)

## Pubblicazione su GitHub Pages

1. Vai su [github.com](https://github.com) → **+** → **New repository**
2. Nome: `cocaine` · **Public** · spunta "Add README"
3. Nel repo, click **Add file** → **Upload files**
4. Trascina dentro **tutti i file di questa cartella** (incluso il sottoinsieme `images/`)
5. Click **Commit changes** in fondo
6. Vai in **Settings** → **Pages** (menu a sinistra)
7. Sotto "Source" → seleziona branch `main` e cartella `/ (root)` → **Save**
8. Aspetta 1-2 minuti
9. Il sito sarà online su `https://TUONOME.github.io/cocaine/`

## Credenziali admin

Vai a `https://tuosito.com/#admin/login`:
- Username: `admin`
- Password: `cocaine2026`

⚠️ Cambia la password dopo il primo accesso (modifica `AUTH.adminInit` in `app.js`).

## Limiti importanti

Il sito salva **tutto in `localStorage` del browser**. Significa:

- ✅ Demo perfetta · navigazione · carrello · checkout simulato
- ❌ Gli ordini di un visitatore **non sono visibili a te come admin** — restano nel suo browser
- ❌ Nessun pagamento reale (la form valida la carta con Luhn ma non addebita nulla)
- ❌ Cancellando i cookie del sito si perdono tutti i dati locali

Per un vero e-commerce serve un backend (database + Stripe). Possiamo aggiungerlo dopo se vuoi.

## Modifiche rapide

| Cosa | Dove |
|---|---|
| Cambiare prezzi/nomi prodotti | `app.js`, oggetto `products` (cerca "Classic Logo Hoodie") |
| Cambiare colori brand | `style.css`, all'inizio (cerca `#fff` e `#050505`) |
| Cambiare testi homepage | `index.html`, sezione `<section class="hero">` |
| Cambiare immagini hoodie | sostituisci i file in `images/` mantenendo gli stessi nomi |

## Browser supportati

Chrome/Edge/Firefox/Safari moderni (ultimi 2 anni). L'animazione su mobile è semplificata.
