// ══════════════════════════════════════════
//  PROEFMODUS BEKER (bekerloting.html + bekertoernooi.html met ?proef=1)
// ══════════════════════════════════════════
// Met ?proef=1 in de URL draait de beker in een afgeschermde proefomgeving:
// - de toernooistaat (beker_toernooi) staat alleen in deze browser (localStorage)
// - wedstrijden die normaal naar de planning gaan worden nagebootst, er komt
//   niets in de echte wedstrijden-tabel en er gaan geen mails uit
// - lezen uit de echte database (bv. de spelerslijst) mag gewoon
// Alle andere schrijfacties worden in proefmodus genegeerd. Zonder ?proef=1
// doet dit bestand niets.
(function(){
  "use strict";
  var params = new URLSearchParams(location.search);
  if(!params.has("proef")){ window.BEKER_PROEF = false; return; }
  window.BEKER_PROEF = true;

  var K_STAAT = "beker_proef_staat";
  var K_WED = "beker_proef_wedstrijden";
  var K_LOTING = "kaalebull-bekerloting-v1-proef"; // prefix van de lokale rad-voortgang in proef
  var SB_URL = "https://ctxurzqtglckairgbjno.supabase.co";
  var SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN0eHVyenF0Z2xja2Fpcmdiam5vIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkxMzExNjYsImV4cCI6MjA5NDcwNzE2Nn0.Ty3nNEyNfZVebxqXRS5RALM7JA5AdghIYAS6VjfFITQ";

  function lees(k, standaard){
    try{ var v = JSON.parse(localStorage.getItem(k)); return v === null || v === undefined ? standaard : v; }
    catch(e){ return standaard; }
  }
  function schrijf(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
  function wisLotingVoortgang(){
    try{
      Object.keys(localStorage).forEach(function(k){ if(k.indexOf(K_LOTING) === 0) localStorage.removeItem(k); });
    }catch(e){}
  }
  function antwoord(body, status){
    return new Response(JSON.stringify(body), { status: status || 200, headers: { "Content-Type": "application/json" } });
  }

  var echteFetch = window.fetch.bind(window);
  window.fetch = async function(input, init){
    init = init || {};
    var url = typeof input === "string" ? input : input.url;
    var method = String(init.method || (typeof input === "string" ? "GET" : input.method) || "GET").toUpperCase();
    if(url.indexOf("/rest/v1/") === -1 && url.indexOf("/functions/v1/") === -1) return echteFetch(input, init);
    if(url.indexOf("/functions/v1/") !== -1) return antwoord({ proef: true }); // geen mails/functies in proef

    var u = new URL(url);
    var tabel = u.pathname.split("/rest/v1/")[1];
    var zoek = decodeURIComponent(u.search);

    if(tabel === "beker_toernooi"){
      if(method === "GET"){
        var s = lees(K_STAAT, null);
        return antwoord(s ? [{ id: "proef", seizoen: "proef", staat: s }] : []);
      }
      if(method === "DELETE"){ try{ localStorage.removeItem(K_STAAT); }catch(e){} return antwoord([]); }
      var rows = JSON.parse(init.body || "[]");
      if(rows[0] && rows[0].staat) schrijf(K_STAAT, rows[0].staat);
      return antwoord(rows, 201);
    }

    if(tabel === "wedstrijden"){
      var w = lees(K_WED, []);
      if(method === "GET"){
        var m = /id=in\.\(([^)]*)\)/.exec(zoek);
        var ids = m ? m[1].split(",") : null;
        return antwoord(ids ? w.filter(function(x){ return ids.indexOf(x.id) !== -1; }) : w);
      }
      if(method === "POST"){
        var nieuw = JSON.parse(init.body || "[]").map(function(r){
          var c = {}; for(var k in r) c[k] = r[k];
          c.id = "proef-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
          return c;
        });
        schrijf(K_WED, w.concat(nieuw));
        return antwoord(nieuw, 201);
      }
      if(method === "PATCH"){
        var idm = /id=eq\.([^&]+)/.exec(zoek);
        var b = JSON.parse(init.body || "{}");
        schrijf(K_WED, w.map(function(x){
          if(!idm || x.id !== idm[1]) return x;
          var c = {}; for(var k in x) c[k] = x[k]; for(var k2 in b) c[k2] = b[k2]; return c;
        }));
        return antwoord([]);
      }
      if(method === "DELETE"){ schrijf(K_WED, []); return antwoord([]); }
    }

    if(method === "GET") return echteFetch(input, init); // lezen uit de echte database mag
    return antwoord([]); // elke andere schrijfactie wordt in proef genegeerd
  };

  // Acties voor de proefbalk
  async function kopieerEchteStand(){
    if(!confirm("De huidige proef wordt vervangen door een kopie van de echte bekerstand. Doorgaan?")) return;
    try{
      var r = await echteFetch(SB_URL + "/rest/v1/beker_toernooi?id=eq.2026-2027", {
        headers: { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY }
      });
      var rows = await r.json();
      if(!rows.length){ alert("Er is nog geen echte bekerstand om te kopiëren."); return; }
      schrijf(K_STAAT, rows[0].staat);
      schrijf(K_WED, []);
      wisLotingVoortgang();
      location.reload();
    }catch(e){ alert("Kopiëren lukte niet: " + e.message); }
  }
  function legeProef(){
    if(!confirm("De proef wordt helemaal leeggemaakt. Je begint opnieuw bij de loting van de voorronde. Doorgaan?")) return;
    try{ localStorage.removeItem(K_STAAT); }catch(e){}
    schrijf(K_WED, []);
    wisLotingVoortgang();
    location.href = "bekerloting.html?proef=1";
  }
  function stopProef(){
    location.href = location.pathname.split("/").pop();
  }

  // Links naar de andere bekerpagina blijven in proefmodus
  document.addEventListener("click", function(e){
    var a = e.target.closest && e.target.closest("a[href]");
    if(!a) return;
    var href = a.getAttribute("href");
    if(/^(bekerloting|bekertoernooi)\.html(\?|$)/.test(href) && href.indexOf("proef") === -1){
      a.setAttribute("href", href + (href.indexOf("?") === -1 ? "?" : "&") + "proef=1");
    }
  }, true);

  function toonBalk(){
    var css = document.createElement("style");
    css.textContent =
      ".proef-balk{position:relative;z-index:50;display:flex;align-items:center;gap:8px;flex-wrap:wrap;" +
      "padding:8px 14px;background:repeating-linear-gradient(135deg,#d9ab3f 0 14px,#c99a2f 14px 28px);color:#1b1305;" +
      "font:600 0.82rem 'Segoe UI',system-ui,sans-serif;}" +
      ".proef-balk b{font-weight:800;letter-spacing:0.5px;}" +
      ".proef-balk .uitleg{flex:1;min-width:200px;}" +
      ".proef-balk button{background:#1b1305;color:#f3ead6;border:0;border-radius:6px;padding:5px 10px;" +
      "font:600 0.75rem 'Segoe UI',system-ui,sans-serif;cursor:pointer;white-space:nowrap;}" +
      ".proef-balk button:hover{background:#3d2c08;}" +
      // Op het rad (bekerloting.html): balk over de volle breedte, knoppen rechtsboven eronder
      "body.proef-rad .proef-balk{margin:-2vh -2.4vw 1.2vh;}" +
      "body.proef-rad .settings{top:calc(1.4vh + 46px);}";
    document.head.appendChild(css);
    var balk = document.createElement("div");
    balk.className = "proef-balk";
    balk.innerHTML =
      '<span class="uitleg"><b>🧪 PROEFMODUS</b> — alleen in deze browser. Er gaat niets naar het echte toernooi, de planning of de spelers.</span>' +
      (window.proefVulUitslagen ? '<button type="button" data-actie="vul">🎲 Vul open uitslagen in</button>' : "") +
      '<button type="button" data-actie="kopie">Kopie van echte stand</button>' +
      '<button type="button" data-actie="leeg">Opnieuw vanaf voorronde</button>' +
      '<button type="button" data-actie="stop">Proef stoppen</button>';
    balk.addEventListener("click", function(e){
      var b = e.target.closest("button[data-actie]");
      if(!b) return;
      var actie = b.dataset.actie;
      if(actie === "vul" && window.proefVulUitslagen) window.proefVulUitslagen();
      if(actie === "kopie") kopieerEchteStand();
      if(actie === "leeg") legeProef();
      if(actie === "stop") stopProef();
    });
    if(document.querySelector(".settings")) document.body.classList.add("proef-rad");
    document.body.insertBefore(balk, document.body.firstChild);
    ["proefLink","proefLinkWrap"].forEach(function(id){ var el = document.getElementById(id); if(el) el.style.display = "none"; });
    document.title = "🧪 PROEF · " + document.title;
  }
  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", toonBalk);
  else toonBalk();
})();
