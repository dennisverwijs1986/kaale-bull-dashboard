/* Eerdere bekerlotingen terugkijken en delen als afbeelding (20-11-2026).
 *
 * Wordt ingeladen door bekerloting.html (en proef/bekerloting.html). Leest de
 * toernooistaat uit beker_toernooi, maakt per loting een overzicht en kan dat
 * als PNG downloaden of via het deelmenu van de telefoon delen (WhatsApp, mail).
 * Staat los van de loting zelf: dit bestand verandert niets aan het toernooi.
 */
(function () {
  "use strict";

  var SB_URL = "https://ctxurzqtglckairgbjno.supabase.co";
  var SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN0eHVyenF0Z2xja2Fpcmdiam5vIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkxMzExNjYsImV4cCI6MjA5NDcwNzE2Nn0.Ty3nNEyNfZVebxqXRS5RALM7JA5AdghIYAS6VjfFITQ";
  var SEIZOEN = "2026-2027";

  var LABEL = {
    ronde1: "Voorronde",
    wr2: "Winnaarsronde 1",
    vr2: "Verliezersronde 1",
    vr3: "Verliezersronde 2",
    wr3: "Winnaarsronde 2",
    vr_kwart: "Verliezersronde — kwartfinale",
    wr_kwart: "Winnaarsronde — kwartfinale",
    vr_halve: "Verliezersronde — halve finale",
    wr_halve: "Winnaarsronde — halve finale",
    vr_finale: "Verliezersronde — finale",
    wr_finale: "Winnaarsronde — finale",
  };
  // Volgorde waarin de lotingen plaatsvinden (verliezersronde vóór winnaarsronde).
  var LOS_GELOOT = ["vr3", "wr3", "vr_kwart", "wr_kwart", "vr_halve", "wr_halve", "vr_finale", "wr_finale"];

  // ── Gegevens: welke lotingen zijn er gedaan? ─────────────────────────────
  function plek(m, kant, bronNaam) {
    var naam = m[kant];
    if (naam) return naam;
    if (m._wachtOpWedstrijd) return "Winnaar " + bronNaam + " " + m._wachtOpWedstrijd;
    return "?";
  }
  function paren(lijst, bronNaam) {
    return (lijst || []).map(function (m) { return [plek(m, "a", bronNaam), plek(m, "b", bronNaam)]; });
  }

  function bouwLotingen(s) {
    var f = (s && s.fases) || {};
    var uit = [];
    var vr3Gebruikt = false;

    if (f.ronde1 && f.ronde1.matches && f.ronde1.matches.length) {
      var secties = [{ titel: "Voorronde", paren: paren(f.ronde1.matches, "voorronde") }];
      if (f.wr2 && f.wr2.matches && f.wr2.matches.length) {
        secties.push({ titel: "Winnaarsronde 1", paren: paren(f.wr2.matches, "voorronde") });
      } else if (s.wr2Voorbereiding) {
        var vb = s.wr2Voorbereiding;
        var p = paren(vb.byeMatches, "voorronde").concat((vb.slots || []).map(function (sl) {
          return [sl.byeSpeler, "Winnaar voorronde " + sl.winnaarVanWedstrijd];
        }));
        secties.push({ titel: "Winnaarsronde 1", paren: p });
      }
      uit.push({ id: "ronde1", titel: "Voorronde", secties: secties });
    }

    if (f.vr2 && f.vr2.matches) {
      var tussen = (f.vr2.bye || []).length > 0;
      var titel = tussen ? "Tussenronde" : LABEL.vr2;
      var sec = [{ titel: titel, paren: paren(f.vr2.matches, "tussenronde") }];
      if (tussen && f.vr3 && f.vr3.matches && f.vr3.matches.length) {
        sec.push({ titel: LABEL.vr3, paren: paren(f.vr3.matches, "tussenronde") });
        vr3Gebruikt = true;
      }
      if (sec[0].paren.length || sec.length > 1) uit.push({ id: "vr2", titel: titel, secties: sec });
    }

    LOS_GELOOT.forEach(function (id) {
      if (id === "vr3" && vr3Gebruikt) return;
      var fase = f[id];
      if (!fase || !fase.matches || !fase.matches.length) return;
      var bron = id === "vr3" ? "verliezersronde 1" : "wedstrijd";
      uit.push({ id: id, titel: LABEL[id], secties: [{ titel: LABEL[id], paren: paren(fase.matches, bron) }] });
    });
    return uit;
  }

  // ── Stijl ─────────────────────────────────────────────────────────────
  var css = "" +
    ".bo-knop{display:inline-flex;align-items:center;gap:.4em;background:transparent;border:1px solid var(--gold,#d9ab3f);color:var(--gold-bright,#f0c25f);" +
    "font-family:'Oswald',sans-serif;font-weight:600;letter-spacing:.04em;border-radius:999px;padding:.45em 1.1em;cursor:pointer;font-size:clamp(13px,1vw,17px);text-decoration:none;}" +
    ".bo-knop:hover{background:rgba(217,171,63,.12);}" +
    ".bo-knop.vol{background:var(--gold,#d9ab3f);color:#0d241b;}" +
    "#boOverlay{position:fixed;inset:0;z-index:9999;background:radial-gradient(ellipse at top,#16352a 0%,#081712 75%);overflow:auto;display:none;color:#f3ead6;}" +
    "#boOverlay.open{display:block;}" +
    ".bo-wrap{max-width:1100px;margin:0 auto;padding:3vh 3vw 6vh;}" +
    ".bo-top{display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;margin-bottom:2vh;}" +
    ".bo-chips{display:flex;flex-wrap:wrap;gap:8px;}" +
    ".bo-chip{background:#16352a;border:1px solid #2c5c46;color:#a9c2b4;border-radius:999px;padding:.4em 1em;font-family:'Work Sans',sans-serif;font-weight:600;cursor:pointer;font-size:clamp(13px,1vw,16px);}" +
    ".bo-chip.actief{border-color:#f0c25f;color:#f0c25f;background:#1c4231;}" +
    ".bo-acties{display:flex;flex-wrap:wrap;gap:8px;}" +
    ".bo-eyebrow{text-align:center;font-family:'Oswald',sans-serif;letter-spacing:.3em;text-transform:uppercase;color:#d9ab3f;font-size:clamp(12px,1.2vw,18px);margin-top:1vh;}" +
    ".bo-titel{text-align:center;font-family:'Anton','Oswald',sans-serif;font-size:clamp(34px,5vw,72px);letter-spacing:.03em;margin:.2em 0 .4em;color:#f3ead6;}" +
    ".bo-sectie{background:rgba(22,53,42,.85);border:1px solid #2c5c46;border-radius:18px;padding:1.6vh 1.6vw;margin-bottom:2vh;}" +
    ".bo-sectie h3{margin:0 0 1vh;font-family:'Oswald',sans-serif;color:#f0c25f;letter-spacing:.06em;text-transform:uppercase;font-size:clamp(18px,1.8vw,28px);display:flex;justify-content:space-between;}" +
    ".bo-sectie h3 small{color:#a9c2b4;font-size:.65em;align-self:center;}" +
    ".bo-rij{display:grid;grid-template-columns:2.2em 1fr auto 1fr;align-items:center;gap:.6em;padding:.45em .4em;border-top:1px solid rgba(44,92,70,.6);font-family:'Work Sans',sans-serif;font-weight:700;font-size:clamp(16px,2vw,32px);}" +
    ".bo-rij:first-of-type{border-top:0;}" +
    ".bo-nr{color:#d9ab3f;font-family:'Oswald',sans-serif;}" +
    ".bo-a{text-align:right;}.bo-vs{color:#d9ab3f;font-family:'Oswald',sans-serif;font-size:.7em;}" +
    ".bo-wacht{color:#a9c2b4;font-style:italic;font-weight:500;}" +
    ".bo-leeg{text-align:center;color:#a9c2b4;font-family:'Work Sans',sans-serif;margin-top:10vh;font-size:18px;}" +
    ".bo-melding{text-align:center;color:#a9c2b4;font-family:'Work Sans',sans-serif;min-height:1.4em;margin-top:1vh;}";
  var st = document.createElement("style");
  st.textContent = css;
  document.head.appendChild(st);

  // ── Overlay ───────────────────────────────────────────────────────────
  var overlay = document.createElement("div");
  overlay.id = "boOverlay";
  overlay.innerHTML =
    '<div class="bo-wrap">' +
    '  <div class="bo-top">' +
    '    <div class="bo-chips" id="boChips"></div>' +
    '    <div class="bo-acties">' +
    '      <button type="button" class="bo-knop vol" id="boDelen">📤 Delen</button>' +
    '      <button type="button" class="bo-knop" id="boDownload">⬇ Afbeelding opslaan</button>' +
    '      <button type="button" class="bo-knop" id="boSluit">✕ Sluiten</button>' +
    "    </div>" +
    "  </div>" +
    '  <div id="boInhoud"></div>' +
    '  <div class="bo-melding" id="boMelding"></div>' +
    "</div>";
  document.body.appendChild(overlay);

  var lotingen = [];
  var gekozen = null;

  function esc(t) {
    return String(t == null ? "" : t).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  var isWacht = function (n) { return /^Winnaar /.test(n); };

  function render() {
    var chips = document.getElementById("boChips");
    var inhoud = document.getElementById("boInhoud");
    document.getElementById("boMelding").textContent = "";
    if (!lotingen.length) {
      chips.innerHTML = "";
      inhoud.innerHTML = '<p class="bo-leeg">Er zijn nog geen lotingen gedaan.</p>';
      return;
    }
    chips.innerHTML = lotingen.map(function (l, i) {
      return '<button type="button" class="bo-chip' + (l === gekozen ? " actief" : "") + '" data-i="' + i + '">' + esc(l.titel) + "</button>";
    }).join("");
    Array.prototype.forEach.call(chips.querySelectorAll(".bo-chip"), function (b) {
      b.onclick = function () { gekozen = lotingen[+b.dataset.i]; render(); };
    });
    var l = gekozen;
    inhoud.innerHTML =
      '<div class="bo-eyebrow">De Kaale Bull · Bekercompetitie</div>' +
      '<div class="bo-titel">Loting ' + esc(l.titel.toLowerCase()) + "</div>" +
      l.secties.map(function (s) {
        return '<div class="bo-sectie"><h3><span>' + esc(s.titel) + "</span><small>" + s.paren.length + " wedstrijd" + (s.paren.length === 1 ? "" : "en") + "</small></h3>" +
          s.paren.map(function (p, i) {
            return '<div class="bo-rij"><span class="bo-nr">' + (i + 1) + '</span><span class="bo-a' + (isWacht(p[0]) ? " bo-wacht" : "") + '">' + esc(p[0]) +
              '</span><span class="bo-vs">VS</span><span class="' + (isWacht(p[1]) ? "bo-wacht" : "") + '">' + esc(p[1]) + "</span></div>";
          }).join("") + "</div>";
      }).join("");
  }

  async function open() {
    overlay.classList.add("open");
    document.getElementById("boInhoud").innerHTML = '<p class="bo-leeg">Lotingen ophalen…</p>';
    document.getElementById("boChips").innerHTML = "";
    try {
      var res = await fetch(SB_URL + "/rest/v1/beker_toernooi?id=eq." + encodeURIComponent(SEIZOEN),
        { headers: { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY } });
      if (!res.ok) throw new Error(await res.text());
      var rows = await res.json();
      lotingen = bouwLotingen(rows.length ? rows[0].staat : null);
      if (!gekozen || lotingen.map(function (x) { return x.id; }).indexOf(gekozen.id) < 0) gekozen = lotingen[lotingen.length - 1] || null;
      else gekozen = lotingen.filter(function (x) { return x.id === gekozen.id; })[0];
      render();
    } catch (e) {
      document.getElementById("boInhoud").innerHTML = '<p class="bo-leeg">Kon de lotingen niet ophalen. Controleer de verbinding en probeer het opnieuw.</p>';
    }
  }
  function sluit() { overlay.classList.remove("open"); }

  // ── Afbeelding (PNG) tekenen ─────────────────────────────────────────
  async function maakPng(l) {
    try {
      await Promise.all([
        document.fonts.load("700 40px 'Work Sans'"), document.fonts.load("600 40px Oswald"), document.fonts.load("40px Anton"),
      ]);
    } catch (e) { /* valt terug op standaardletters */ }
    var B = 1080, PAD = 60, RIJ = 64, KOP = 70, SECPAD = 28;
    var hoogte = 300 + l.secties.reduce(function (t, s) { return t + KOP + s.paren.length * RIJ + SECPAD * 2 + 30; }, 0) + 70;
    var c = document.createElement("canvas");
    c.width = B; c.height = hoogte;
    var g = c.getContext("2d");
    var grad = g.createRadialGradient(B / 2, 0, 50, B / 2, 0, hoogte);
    grad.addColorStop(0, "#1c4231"); grad.addColorStop(1, "#081712");
    g.fillStyle = grad; g.fillRect(0, 0, B, hoogte);

    g.textAlign = "center"; g.textBaseline = "alphabetic";
    g.fillStyle = "#d9ab3f"; g.font = "600 26px Oswald, sans-serif";
    g.fillText("DE KAALE BULL  ·  BEKERCOMPETITIE", B / 2, 90);
    g.fillStyle = "#f3ead6"; g.font = "78px Anton, Oswald, sans-serif";
    pasIn(g, "LOTING " + l.titel.toUpperCase(), B - 2 * PAD, 78, "px Anton, Oswald, sans-serif", "");
    g.fillText("LOTING " + l.titel.toUpperCase(), B / 2, 190);

    var y = 250;
    l.secties.forEach(function (s) {
      var h = KOP + s.paren.length * RIJ + SECPAD * 2;
      rondeRect(g, PAD, y, B - 2 * PAD, h, 22);
      g.fillStyle = "rgba(22,53,42,0.9)"; g.fill();
      g.strokeStyle = "#2c5c46"; g.lineWidth = 2; g.stroke();
      g.textAlign = "left"; g.fillStyle = "#f0c25f"; g.font = "600 34px Oswald, sans-serif";
      g.fillText(s.titel.toUpperCase(), PAD + 30, y + SECPAD + 36);
      g.textAlign = "right"; g.fillStyle = "#a9c2b4"; g.font = "500 22px 'Work Sans', sans-serif";
      g.fillText(s.paren.length + " wedstrijd" + (s.paren.length === 1 ? "" : "en"), B - PAD - 30, y + SECPAD + 34);
      var ry = y + SECPAD + KOP;
      s.paren.forEach(function (p, i) {
        if (i > 0) { g.strokeStyle = "rgba(44,92,70,0.7)"; g.lineWidth = 1; g.beginPath(); g.moveTo(PAD + 24, ry - 2); g.lineTo(B - PAD - 24, ry - 2); g.stroke(); }
        var mid = ry + RIJ / 2 + 11;
        g.textAlign = "left"; g.fillStyle = "#d9ab3f"; g.font = "600 30px Oswald, sans-serif";
        g.fillText(String(i + 1), PAD + 30, mid);
        var midX = B / 2 + 20, max = (B - 2 * PAD - 110) / 2 - 40;
        g.textAlign = "center"; g.fillStyle = "#d9ab3f"; g.font = "600 22px Oswald, sans-serif";
        g.fillText("VS", midX, mid - 2);
        [[p[0], "right", midX - 34], [p[1], "left", midX + 34]].forEach(function (z) {
          var wacht = isWacht(z[0]);
          g.textAlign = z[1]; g.fillStyle = wacht ? "#a9c2b4" : "#f3ead6";
          var stijl = wacht ? "italic 500 " : "700 ";
          pasIn(g, z[0], max, 32, "px 'Work Sans', sans-serif", stijl);
          g.fillText(z[0], z[2], mid);
        });
        ry += RIJ;
      });
      y += h + 30;
    });
    g.textAlign = "center"; g.fillStyle = "#a9c2b4"; g.font = "500 20px 'Work Sans', sans-serif";
    g.fillText("Bo5 t/m de kwartfinales · Bo7 halve finales · Bo9 finales", B / 2, hoogte - 34);
    return await new Promise(function (r) { c.toBlob(r, "image/png"); });
  }
  function pasIn(g, tekst, max, start, rest, voor) {
    var size = start;
    do { g.font = (voor || "") + size + rest; size -= 1; } while (g.measureText(tekst).width > max && size > 14);
  }
  function rondeRect(g, x, y, w, h, r) {
    g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }
  function bestandsnaam(l) {
    return "Bekerloting " + l.titel.replace(/[—\/]/g, "-").replace(/\s+/g, " ").trim() + ".png";
  }
  function melding(t) { document.getElementById("boMelding").textContent = t; }

  async function download() {
    if (!gekozen) return;
    var blob = await maakPng(gekozen);
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = bestandsnaam(gekozen);
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
    melding("Afbeelding opgeslagen.");
  }
  async function delen() {
    if (!gekozen) return;
    var blob = await maakPng(gekozen);
    var bestand = new File([blob], bestandsnaam(gekozen), { type: "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [bestand] })) {
      try {
        await navigator.share({ files: [bestand], title: "Bekerloting " + gekozen.titel.toLowerCase() });
        return;
      } catch (e) {
        if (e && e.name === "AbortError") return; // gebruiker sloot het deelmenu
      }
    }
    // Delen kan niet op dit apparaat (bv. Windows-laptop): dan gewoon opslaan.
    await download();
    melding("Delen kan hier niet; de afbeelding is opgeslagen zodat je hem zelf kunt versturen.");
  }

  document.getElementById("boSluit").onclick = sluit;
  document.getElementById("boDownload").onclick = download;
  document.getElementById("boDelen").onclick = delen;
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && overlay.classList.contains("open")) sluit(); });

  // ── Knoppen op de lotingpagina ───────────────────────────────────────
  function knop(extraStijl) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "bo-knop";
    b.textContent = "📋 Eerdere lotingen";
    if (extraStijl) b.style.cssText = extraStijl;
    b.onclick = open;
    return b;
  }
  var doneLine = document.getElementById("doneLine");
  if (doneLine) doneLine.appendChild(knop("margin-left:.6em;font-size:clamp(11px,0.85vw,15px);padding:.3em .9em;"));
  var geen = document.getElementById("geenLotingPanel");
  if (geen) {
    // Boven de (absoluut gepositioneerde) link naar het bekertoernooi, zodat ze niet overlappen.
    var link = geen.querySelector("a.ghost-btn");
    var k = knop("margin:1.4vh 0 5.5vh;position:static;");
    if (link) geen.insertBefore(k, link); else geen.appendChild(k);
  }
  // Altijd bereikbaar, ook tijdens een loting: klein knopje rechtsonder.
  var vast = knop("position:fixed;right:1.2vw;bottom:1.2vh;z-index:50;font-size:13px;padding:.35em .9em;background:rgba(8,23,18,.85);");
  document.body.appendChild(vast);

  window.toonEerdereLotingen = open;
  window.__bouwLotingen = bouwLotingen; // voor testen
})();
