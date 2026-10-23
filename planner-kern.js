// ══════════════════════════════════════════
//  AVONDPLANNER — gedeelde rekenkern
//  Gebruikt door optimaliseer.html (avondplanner) en index.html (verzet-modal).
//
//  Regel: tussen twee wedstrijden van dezelfde speler minstens 2 lege tijdsloten.
//  Eén slot ertussen = spelen → schrijven → spelen (een uur aan het bord),
//  direct achter elkaar = twee keer spelen zonder pauze.
//  Er wordt alleen binnen een avond geschoven; de slotcapaciteit blijft gelijk.
//
//  Gebruik:  const AP = AvondPlanner.maak(PT_SLOTS);
//  Wedstrijden (ms) zijn objecten met thuis, uit, tijdstip en optioneel:
//    vast:true        → mag niet schuiven (gespeeld, op een bord, ...)
//    vrijeKeuze:true  → schuiven kost niets (bv. de wedstrijd die je net verzet)
// ══════════════════════════════════════════
(function (global) {
  const GEWICHT = { zelfde: 1000, direct: 10, eenErtussen: 4, verschuiving: 1 };

  function maak(SLOTS) {
    const slotIndex = tijd => SLOTS.findIndex(s => s.tijd === tijd);
    const spelersVan = w => [w.thuis, w.uit].filter(n => n && n !== 'Vrije Ronde');

    // Knelpunten bij een slot-toewijzing (slots[i] hoort bij ms[i]).
    function knelpunten(ms, slots) {
      const per = new Map();
      ms.forEach((w, i) => spelersVan(w).forEach(n => { if (!per.has(n)) per.set(n, []); per.get(n).push(i); }));
      const lijst = [];
      for (const [speler, idx] of per) {
        idx.sort((a, b) => slots[a] - slots[b]);
        for (let k = 1; k < idx.length; k++) {
          const a = idx[k - 1], b = idx[k], gap = slots[b] - slots[a] - 1;
          if (gap < 0) lijst.push({ speler, soort: 'zelfde', a, b });
          else if (gap === 0) lijst.push({ speler, soort: 'direct', a, b });
          else if (gap === 1) lijst.push({ speler, soort: 'eenErtussen', a, b });
        }
      }
      return lijst;
    }
    function telKnelpunten(lijst) {
      const t = { zelfde: 0, direct: 0, eenErtussen: 0 }; lijst.forEach(k => t[k.soort]++); return t;
    }
    function kosten(ms, slots, orig) {
      let c = 0;
      for (const k of knelpunten(ms, slots)) c += GEWICHT[k.soort];
      for (let i = 0; i < slots.length; i++) if (slots[i] !== orig[i] && !ms[i].vrijeKeuze) c += GEWICHT.verschuiving;
      return c;
    }
    function capaciteiten(orig, laatste) {
      const cnt = new Array(SLOTS.length).fill(0); orig.forEach(s => cnt[s]++);
      return SLOTS.map((s, i) => i > laatste ? 0 : Math.max(s.cap, cnt[i]));
    }
    // Pseudo-random met seed: dezelfde avond geeft telkens hetzelfde voorstel.
    function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

    // Geeft nieuwe slot-indexen terug. opts.laatste = hoogste slot dat gebruikt mag worden
    // (standaard: het laatste slot dat nu al gebruikt wordt, zodat de avond niet later wordt).
    function optimaliseer(ms, opts = {}) {
      const { iteraties = 30000, pogingen = 6 } = opts;
      const orig = ms.map(w => slotIndex(w.tijdstip));
      const laatste = opts.laatste ?? Math.max(...orig);
      const cap = capaciteiten(orig, laatste);
      const vrij = ms.map((w, i) => w.vast ? -1 : i).filter(i => i >= 0);
      let besteS = orig.slice(), besteC = kosten(ms, orig, orig);
      if (!vrij.length) return besteS;
      for (let p = 0; p < pogingen; p++) {
        const r = rng(1234567 + p * 7919 + ms.length);
        let slots = orig.slice(), cur = kosten(ms, slots, orig);
        const bezet = new Array(SLOTS.length).fill(0); slots.forEach(s => bezet[s]++);
        for (let it = 0; it < iteraties; it++) {
          const T = 5 * (1 - it / iteraties) + 0.01;
          const i = vrij[Math.floor(r() * vrij.length)];
          const t = Math.floor(r() * (laatste + 1));
          if (t === slots[i]) continue;
          const nieuw = slots.slice();
          let j = -1;
          if (bezet[t] < cap[t] && r() < 0.5) {
            nieuw[i] = t;
          } else {
            const kand = vrij.filter(k => slots[k] === t);
            if (!kand.length) continue;
            j = kand[Math.floor(r() * kand.length)];
            nieuw[i] = t; nieuw[j] = slots[i];
          }
          const c = kosten(ms, nieuw, orig);
          if (c <= cur || r() < Math.exp((cur - c) / T)) {
            if (j < 0) { bezet[slots[i]]--; bezet[t]++; }
            slots = nieuw; cur = c;
            if (c < besteC) { besteC = c; besteS = nieuw.slice(); }
          }
        }
      }
      return opruimen(ms, besteS, orig, cap);
    }

    // Zet verschuivingen terug (los, of als ruil-paar) zolang de uitkomst niet slechter wordt.
    function opruimen(ms, slots, orig, cap) {
      slots = slots.slice();
      let cur = kosten(ms, slots, orig), beter = true;
      while (beter) {
        beter = false;
        const bezet = new Array(SLOTS.length).fill(0); slots.forEach(s => bezet[s]++);
        for (let i = 0; i < slots.length; i++) {
          if (slots[i] === orig[i]) continue;
          if (bezet[orig[i]] < cap[orig[i]]) {
            const n = slots.slice(); n[i] = orig[i];
            const c = kosten(ms, n, orig);
            if (c < cur) { slots = n; cur = c; beter = true; break; }
          }
          for (let j = 0; j < slots.length; j++) {
            if (j === i || slots[j] !== orig[i] || ms[j].vast) continue;
            const n = slots.slice(); n[i] = orig[i]; n[j] = slots[i];
            const c = kosten(ms, n, orig);
            if (c < cur) { slots = n; cur = c; beter = true; break; }
          }
          if (beter) break;
        }
      }
      return slots;
    }

    const slotsMetSelectie = (orig, voorstel, gekozen) => orig.map((s, i) => gekozen.has(i) ? voorstel[i] : s);
    function overvol(slots, cap) {
      const cnt = new Array(SLOTS.length).fill(0); slots.forEach(s => cnt[s]++);
      return cnt.map((n, i) => ({ i, n, cap: cap[i] })).filter(x => x.n > x.cap);
    }

    // Rustniveau voor één speler(paar) op een tijd, op basis van minuten (werkt ook met afwijkende tijden).
    //  'zelfde' (<20 min) · 'krap' (direct of één slot ertussen, <60 min) · 'ok'
    function rustNiveau(nieuwMin, andereMinuten) {
      let niveau = 'ok';
      for (const m of andereMinuten) {
        const d = Math.abs(m - nieuwMin);
        if (d < 20) return 'zelfde';
        if (d < 60) niveau = 'krap';
      }
      return niveau;
    }

    return { GEWICHT, slotIndex, spelersVan, knelpunten, telKnelpunten, kosten, capaciteiten, optimaliseer, slotsMetSelectie, overvol, rustNiveau };
  }

  global.AvondPlanner = { maak };
})(typeof window !== 'undefined' ? window : globalThis);
