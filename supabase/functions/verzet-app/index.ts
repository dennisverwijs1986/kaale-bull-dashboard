import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer/mod.ts";
import { esc, KLEUR, datumKort, datumLang, tekstRij, detailKaart, knop, mailHtml, GROET_TEKST } from "./mail-layout.ts";

// ══════════════════════════════════════════════════════════════════════
//  Verzetten via de spelers-app (Dashboard 2.0)
//  Spelers verzetten naar een AVOND (geen tijd), de tegenstander bevestigt.
//  Alle toegang loopt via deze functie; de tabellen zijn dicht voor anon.
//
//  Speler-acties (met persoonlijke code van 6 tekens, = begin van speler_tokens.token):
//    status        { naam }                         -> staat verzetten via de app aan voor deze speler?
//    mijn          { code, naam }                   -> aanvragen voor mij + mijn lopende voorstellen
//    avonden       { code, naam, wedstrijd_id }     -> avonden om naartoe te verzetten (met drukte)
//    voorstel      { code, naam, wedstrijd_id, datum, reden? }
//    intrekken     { code, naam, voorstel_id }
//    afmelden      { code, naam, datum, wedstrijd_ids[] }  -> wedstrijden van die avond op NNB
//    later         { code, naam, datum?, tijd }     -> "Ik ben later", vanaf de vrijdag vóór de speelavond
//    later_intrekken { code, naam, datum }
//  Tegenstander (met de geheime link uit mail/push, geen code nodig):
//    bekijk        { antwoord }
//    avonden       { antwoord }                     -> avonden voor een tegenvoorstel
//    antwoord      { antwoord, besluit:'akkoord'|'afwijzen', reden_keuze?, reden? }
//    tegenvoorstel { antwoord, datum, reden? }
//  Wedstrijdleiding:
//    wl_overzicht  { wachtwoord }                   -> beheerwachtwoord van spelerbeheer
//    wl_besluit    { wachtwoord, id, besluit }      -> akkoord/afwijzen namens de tegenstander
//  Systeem (x-cron-secret of service role):
//    opvolging                                      -> elk uur: herinneren / laten vervallen
//
//  Schakelaar instellingen.verzetten_app: 'uit', komma-lijst met namen, of 'iedereen'.
//  PROEF: zolang niet 'iedereen' en de tegenstander geen tester is, gaan de berichten voor de
//  tegenstander naar de aanvrager zelf (met vermelding) en wordt er niets echt verzet.
// ══════════════════════════════════════════════════════════════════════

const APP = "https://dennisverwijs1986.github.io/kaale-bull-dashboard/schema/";
const DEADLINE_MIN = 10 * 60 + 10;         // speelavond zelf: verzoeken tot 10:10 (spelers horen 10:00)
const AFMELD_DEADLINE_MIN = 19 * 60;       // speeldag zelf: afmelden voor vanavond kan tot 19:00
const VERVAL_ZELFDE_DAG_MIN = 16 * 60;     // voorstel voor dezelfde avond: bevestigen vóór 16:00
const MIN_RUST = 20;
const HERINNER_NA_DAGEN = 3;
const VERVAL_NA_DAGEN = 7;
const MAX_RONDES = 3;
const LATER_DAGEN_VOORUIT = 6;               // "Ik ben later" vanaf de vrijdag vóór de speelavond (do)                       // na 3 rondes heen-en-weer: "App elkaar even"
const BYE = /vrije ronde/i;
const STANDAARD_SLOTS: Record<string, number> = { "19:30": 4, "19:50": 4, "20:10": 4, "20:30": 4, "20:50": 4, "21:10": 4, "21:30": 4, "21:50": 3, "22:10": 3, "22:30": 3, "22:50": 3 };

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GMAIL_USER = Deno.env.get("GMAIL_USER")!;
const GMAIL_APP_PASSWORD = Deno.env.get("GMAIL_APP_PASSWORD")!;
const sb = createClient(SB_URL, SERVICE, { auth: { persistSession: false } });

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
class Fout extends Error { constructor(msg: string, public status = 400) { super(msg); } }

// ── Tijd (altijd Nederlandse tijd) ──
function nlNu() {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { datum: `${p.year}-${p.month}-${p.day}`, min: (+p.hour % 24) * 60 + +p.minute };
}
function plusDagen(datum: string, n: number) {
  const [y, m, d] = datum.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
/** Tijdstip als ISO (UTC) voor een Nederlandse datum + kloktijd. */
function nlMoment(datum: string, minuten: number): string {
  const [y, m, d] = datum.split("-").map(Number);
  const gok = Date.UTC(y, m - 1, d, Math.floor(minuten / 60), minuten % 60);
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Amsterdam", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date(gok)).map((x) => [x.type, x.value]));
  const verschil = ((+p.hour % 24) * 60 + +p.minute) - (Math.floor(minuten / 60) * 60 + minuten % 60); // offset in minuten
  return new Date(gok - verschil * 60000).toISOString();
}
const naarMin = (t: string | null) => { const d = /^(\d{1,2}):(\d{2})/.exec(t || ""); return d ? +d[1] * 60 + +d[2] : null; };
const isUuid = (s: unknown) => typeof s === "string" && /^[0-9a-f-]{36}$/i.test(s);
const isDatum = (s: unknown) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const voornaam = (n: string) => String(n || "").split(" ")[0];

// ── Instellingen ──
async function config() {
  const { data } = await sb.from("instellingen").select("sleutel, waarde")
    .in("sleutel", ["verzetten_app", "wl_push_spelers", "slot_cap_standaard", "planning_kantel_dag", "wedstrijdleiding_email"]);
  const I: Record<string, string> = Object.fromEntries((data || []).map((r: any) => [r.sleutel, r.waarde]));
  const lijst = (s: string | undefined) => String(s || "").split(",").map((x) => x.trim()).filter(Boolean);
  let slots = STANDAARD_SLOTS;
  try { const p = JSON.parse(I.slot_cap_standaard || ""); if (p && typeof p === "object" && Object.keys(p).length) slots = p; } catch { /* standaard */ }
  const SLOTS = Object.entries(slots).map(([tijd, cap]) => ({ tijd, cap: Number(cap) || 0 })).sort((a, b) => a.tijd.localeCompare(b.tijd));
  const app = String(I.verzetten_app || "uit").trim();
  const kantel = parseInt(I.planning_kantel_dag || "", 10);
  return {
    iedereen: app.toLowerCase() === "iedereen",
    testers: app.toLowerCase() === "uit" ? [] : lijst(app),
    wlSpelers: lijst(I.wl_push_spelers),
    wlMail: I.wedstrijdleiding_email || null,
    SLOTS, MAX: SLOTS.reduce((t, s) => t + s.cap, 0),
    kantel: kantel >= 1 && kantel <= 28 ? kantel : 24,
  };
}
type Cfg = Awaited<ReturnType<typeof config>>;
const actiefVoor = (naam: string, cfg: Cfg) => cfg.iedereen || cfg.testers.includes(naam);
const proefVoor = (tegNaam: string, cfg: Cfg) => !cfg.iedereen && !cfg.testers.includes(tegNaam);

// Planningshorizon: voor de kanteldag t/m eind volgende maand, vanaf de kanteldag t/m eind van de maand daarna.
function horizon(vandaag: string, kantel: number) {
  const [y, m, d] = vandaag.split("-").map(Number);
  return new Date(Date.UTC(y, m + (d >= kantel ? 2 : 1), 0)).toISOString().slice(0, 10);
}

// ── Spelers ──
async function spelerVanCode(code: unknown, naam?: unknown) {
  const c = String(code || "").toLowerCase().replace(/[^0-9a-f]/g, "");
  if (c.length !== 6) throw new Fout("Vul je persoonlijke code van 6 tekens in.", 401);
  const { data } = await sb.from("speler_tokens").select("speler_id, token");
  const hits = (data || []).filter((r: any) => String(r.token).replace(/-/g, "").startsWith(c));
  if (hits.length !== 1) throw new Fout("Deze code klopt niet. Controleer de code uit je mail.", 401);
  const { data: sp } = await sb.from("spelers").select("id, naam").eq("id", hits[0].speler_id).maybeSingle();
  if (!sp) throw new Fout("Deze code klopt niet.", 401);
  if (naam && String(naam) !== sp.naam) throw new Fout(`Deze code hoort bij ${sp.naam}. Kies bij Instellingen je eigen naam, of gebruik de code uit je eigen mail.`, 403);
  return sp as { id: string; naam: string };
}
async function spelerOpNaam(naam: string) {
  const { data } = await sb.from("spelers").select("id, naam").eq("naam", naam).maybeSingle();
  return data as { id: string; naam: string } | null;
}
async function naamVan(id: string | null) {
  if (!id) return null;
  const { data } = await sb.from("spelers").select("naam").eq("id", id).maybeSingle();
  return data?.naam ?? null;
}
async function emailVan(spelerId: string | null) {
  if (!spelerId) return [];
  const { data } = await sb.from("spelers_contact").select("email").eq("speler_id", spelerId);
  return (data || []).map((r: any) => String(r.email || "").trim()).filter(Boolean);
}

// ── Wedstrijden ──
async function wedstrijd(id: string) {
  const { data } = await sb.from("wedstrijden").select("*").eq("id", id).maybeSingle();
  if (!data) throw new Fout("Wedstrijd niet gevonden.", 404);
  return data as any;
}
const isBye = (w: any) => BYE.test(w.thuis || "") || BYE.test(w.uit || "") || !w.thuis || !w.uit;
const gespeeld = (w: any) => !!w.uitslag || /gespeeld/i.test(w.status || "") || w.legs_thuis != null;
const tegenstanderVan = (w: any, naam: string) => (w.thuis === naam ? w.uit : w.thuis);
const isBeker = (w: any) => /^beker/i.test(String(w.divisie || ""));

/** Mag deze wedstrijd (nog) verzet/afgemeld worden door deze speler? Geeft een reden terug als het niet mag. */
function bezwaar(w: any, naam: string, nu = nlNu(), afmelden = false) {
  if (w.thuis !== naam && w.uit !== naam) return "Dit is niet jouw wedstrijd.";
  if (isBye(w)) return "Een vrije ronde kan niet verzet worden.";
  if (gespeeld(w)) return "Deze wedstrijd is al gespeeld.";
  if (w.bord) return "Deze wedstrijd is al bezig.";
  if (!w.datum_nnb && w.datum) {
    const d = String(w.datum);
    if (d < nu.datum) return "Deze wedstrijd ligt al in het verleden. Neem contact op met de wedstrijdleiding.";
    if (d === nu.datum && afmelden && nu.min >= AFMELD_DEADLINE_MIN) return "Afmelden voor vanavond kon tot 19:00. Neem contact op met de wedstrijdleiding.";
    if (d === nu.datum && !afmelden && nu.min >= DEADLINE_MIN) return "Verzetten van vanavond kon tot 10:00. Kun je niet? Meld je af voor vanavond (kan tot 19:00).";
  }
  return null;
}

async function avondRijen(datum: string) {
  const { data } = await sb.from("wedstrijden").select("id, datum, tijdstip, thuis, uit, datum_nnb, status").eq("datum", datum).eq("datum_nnb", false);
  return (data || []).filter((x: any) => !isBye(x));
}
const telSpeler = (rijen: any[], naam: string, behalve: string) => rijen.filter((x) => x.id !== behalve && (x.thuis === naam || x.uit === naam)).length;

/** Speelavonden om naartoe te verzetten, met drukte vanuit het perspectief van `ik`. */
async function avondenVoor(w: any, ik: string, cfg: Cfg, nu = nlNu()) {
  const tot = horizon(nu.datum, cfg.kantel);
  const vanaf = plusDagen(nu.datum, 1);   // nooit naar vanavond: op de speeldag zelf alleen "Ik ben later" / afmelden
  const { data } = await sb.from("wedstrijden").select("id, datum, tijdstip, thuis, uit, datum_nnb, status")
    .gte("datum", vanaf).lte("datum", tot).eq("datum_nnb", false);
  const rijen = (data || []).filter((x: any) => !isBye(x));
  const teg = tegenstanderVan(w, ik);
  const perDatum = new Map<string, any[]>();
  rijen.forEach((x: any) => { const d = String(x.datum); if (!perDatum.has(d)) perDatum.set(d, []); perDatum.get(d)!.push(x); });
  return [...perDatum.keys()].sort().map((d) => {
    const r = perDatum.get(d)!;
    const totaal = r.filter((x) => x.id !== w.id).length;
    return {
      datum: d, totaal, max: cfg.MAX, vol: totaal >= cfg.MAX, bijna: totaal >= cfg.MAX - 3,
      ik: telSpeler(r, ik, w.id), teg: telSpeler(r, teg, w.id),
      huidig: !w.datum_nnb && String(w.datum) === d, vandaag: d === nu.datum,
    };
  });
}

/** Kies een tijdslot op de nieuwe avond: plek in het slot en zoveel mogelijk rust voor beide spelers. */
function kiesSlot(w: any, rijen: any[], cfg: Cfg) {
  const anderen = rijen.filter((x) => x.id !== w.id);
  const opties = cfg.SLOTS.map((s) => {
    const m = naarMin(s.tijd)!;
    const bezet = anderen.filter((x) => x.tijdstip === s.tijd).length;
    const gaps = anderen.filter((x) => [x.thuis, x.uit].some((n) => n === w.thuis || n === w.uit))
      .map((x) => naarMin(x.tijdstip)).filter((x) => x !== null).map((x) => Math.abs((x as number) - m));
    const gap = gaps.length ? Math.min(...gaps) : 999;
    return { tijd: s.tijd, plek: bezet < s.cap, gap };
  });
  return (opties.find((o) => o.plek && o.gap > MIN_RUST) || opties.find((o) => o.plek && o.gap >= MIN_RUST) ||
    opties.find((o) => o.plek) || opties[opties.length - 1]).tijd;
}

// ── Berichten ──
/** Wie krijgt het bericht echt? In een test (proef) altijd de tester zelf. */
async function ontvanger(v: any, id: string | null, naam: string) {
  if (v.proef && v.proef_eigenaar) {
    if (v.proef_eigenaar === id) return { id, naam, test: false };
    const n = (await naamVan(v.proef_eigenaar)) || naam;
    return { id: v.proef_eigenaar as string, naam: n, test: true };
  }
  return { id, naam, test: false };
}
let smtp: SMTPClient | null = null;
async function mail(opts: { naar: string[]; onderwerp: string; kopKlein: string; kopGroot: string; accent?: string; rijen: string; tekst: string; proefVoor?: string | null }) {
  if (!opts.naar.length) return;
  if (!smtp) smtp = new SMTPClient({ connection: { hostname: "smtp.gmail.com", port: 465, tls: true, auth: { username: GMAIL_USER, password: GMAIL_APP_PASSWORD } } });
  const banner = opts.proefVoor !== undefined && opts.proefVoor !== null
    ? tekstRij(`<div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:6px;padding:10px 12px;font-size:14px;color:#78350f;"><strong>Test.</strong> Deze mail zou in het echt naar <strong>${esc(opts.proefVoor)}</strong> gaan. Er wordt niets echt verzet.</div>`, "16px 24px 0 24px")
    : "";
  const html = mailHtml({ kopKlein: opts.kopKlein, kopGroot: opts.kopGroot, accent: opts.accent, rijen: banner + opts.rijen }).replace(/[ \t]+\n/g, "\n");
  const voor = opts.proefVoor ? `[TEST - bedoeld voor ${opts.proefVoor}]\n\n` : "";
  for (const naar of opts.naar) {
    try {
      await smtp.send({ from: `Wedstrijdleiding De Kaale Bull <${GMAIL_USER}>`, to: naar, subject: (opts.proefVoor ? "[TEST] " : "") + opts.onderwerp, content: voor + opts.tekst + GROET_TEKST, html });
    } catch (e) { console.error("mail mislukt", naar, e); }
  }
}
async function sluitMail() { try { await smtp?.close(); } catch { /* */ } smtp = null; }

async function push(spelers: string[], titel: string, tekst: string, url: string, soort: string) {
  if (!spelers.length) return;
  try {
    await fetch(`${SB_URL}/functions/v1/push`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE}` },
      body: JSON.stringify({ actie: "stuur", spelers, titel, tekst, url, soort }),
    });
  } catch (e) { console.error("push mislukt", e); }
}
/** Melding aan de wedstrijdleiding: push aan de WL-spelers + mail naar het WL-adres. */
async function wlPush(cfg: Cfg, tekst: string, titel = "🎯 Wedstrijdleiding") {
  await push(cfg.wlSpelers, titel, tekst, "../wl.html?view=aanvragen", "wl_melding");
  if (cfg.wlMail) await mail({ naar: [cfg.wlMail], onderwerp: `${titel.replace(/^\S+\s/, "")}: ${tekst.slice(0, 60)}`, kopKlein: "Wedstrijdleiding", kopGroot: titel.replace(/^\S+\s/, ""),
    rijen: tekstRij(`<p style="margin:0;">${esc(tekst)}</p>`) + knop("Open de WL-app", "https://dennisverwijs1986.github.io/kaale-bull-dashboard/wl.html?view=aanvragen"), tekst });
}
const aanvraagUrl = (token: string) => `${APP}?aanvraag=${token}`;
/** Link naar de app die meteen het schema van deze speler opent (ook in de browser, zonder naam kiezen). */
const appUrl = (naam: string) => `${APP}?speler=${encodeURIComponent(naam)}`;

/** Bericht aan de tegenstander over een (tegen)voorstel. In proef: naar de aanvrager zelf. */
async function meldVoorstel(v: any, w: any, vanNaam: string, naarId: string | null, naarNaam: string) {
  const o = await ontvanger(v, naarId, naarNaam);
  const naarMails = await emailVan(o.id);
  const oud = v.oude_datum ? datumKort(v.oude_datum) : null;
  const nieuw = datumKort(v.nieuwe_datum);
  const tegen = v.ronde > 1;
  const titel = tegen ? "🔁 Tegenvoorstel" : v.soort === "inplannen" ? "🗓 Verzoek om in te plannen" : "📅 Verzoek om te verzetten";
  const zin = v.soort === "inplannen"
    ? `${vanNaam} wil jullie wedstrijd inplannen op ${nieuw}.`
    : `${vanNaam} ${tegen ? "stelt voor" : "wil"} jullie wedstrijd${oud ? ` van ${oud}` : ""} ${tegen ? "te spelen op" : "verzetten naar"} ${nieuw}.`;
  if (o.id) await push([o.naam], (o.test ? "[TEST] " : "") + titel, zin + " Tik om te reageren.", `./?aanvraag=${v.antwoord_token}`, "verzet_aanvraag");
  const kaart = detailKaart([
    ["Wedstrijd", `${esc(w.thuis)} – ${esc(w.uit)}`],
    ["Nu", oud ? `<span style="color:${KLEUR.grijs};">${esc(datumLang(v.oude_datum))}</span>` : "nog niet gepland"],
    [tegen ? "Tegenvoorstel" : "Voorstel", `<strong style="font-size:18px;">${esc(datumLang(v.nieuwe_datum))}</strong>`],
    ...(v.reden ? [["Toelichting", esc(v.reden)] as [string, string]] : []),
  ]);
  const zelfdeDag = v.vervalt_at ? "Reageer graag vóór 16:00 vandaag, anders vervalt het verzoek." : `Reageer graag binnen ${HERINNER_NA_DAGEN} dagen. Zonder reactie vervalt het verzoek na ${VERVAL_NA_DAGEN} dagen.`;
  await mail({
    naar: naarMails, proefVoor: o.test ? naarNaam : null,
    onderwerp: `${tegen ? "Tegenvoorstel" : "Verzoek"}: ${w.thuis} vs ${w.uit}`,
    kopKlein: "Verzetten", kopGroot: tegen ? "Tegenvoorstel voor jullie wedstrijd" : v.soort === "inplannen" ? "Verzoek om jullie wedstrijd in te plannen" : "Verzoek om je wedstrijd te verzetten",
    rijen: tekstRij(`<p style="margin:0 0 12px 0;">Beste ${esc(voornaam(naarNaam))},</p><p style="margin:0;">${esc(zin)}</p>`) + kaart +
      knop("Bekijken en reageren", aanvraagUrl(v.antwoord_token)) +
      tekstRij(`<span style="font-size:14px;color:${KLEUR.grijs};">${esc(zelfdeDag)} De wedstrijdleiding kijkt mee.</span>`, "10px 24px 0 24px"),
    tekst: `Beste ${voornaam(naarNaam)},\n\n${zin}${v.reden ? `\nToelichting: ${v.reden}` : ""}\n\nBekijken en reageren: ${aanvraagUrl(v.antwoord_token)}\n\n${zelfdeDag}`,
  });
}

// ── Voorstel aanmaken (ook gebruikt voor tegenvoorstel) ──
async function maakVoorstel(w: any, ini: { id: string; naam: string }, datum: string, reden: string | null, cfg: Cfg, extra: { vorige?: any } = {}) {
  const nu = nlNu();
  const avonden = await avondenVoor(w, ini.naam, cfg, nu);
  const a = avonden.find((x) => x.datum === datum);
  if (!a) throw new Fout("Kies een speelavond uit de lijst.");
  if (a.huidig) throw new Fout("De wedstrijd staat al op die avond.");
  const { count } = await sb.from("verzet_voorstel").select("id", { count: "exact", head: true }).eq("wedstrijd_id", w.id).eq("status", "voorgesteld");
  if ((count ?? 0) > 0) throw new Fout("Voor deze wedstrijd loopt al een verzoek.");
  const tegNaam = tegenstanderVan(w, ini.naam);
  const teg = await spelerOpNaam(tegNaam);
  const zelfdeDag = datum === nu.datum || (!w.datum_nnb && String(w.datum) === nu.datum);
  const v0 = extra.vorige;
  const rec = {
    wedstrijd_id: w.id, initiator_id: ini.id, tegenstander_id: teg?.id || null,
    oude_datum: w.datum_nnb ? null : w.datum, oude_tijdstip: w.datum_nnb ? null : w.tijdstip,
    nieuwe_datum: datum, nieuwe_tijdstip: null, reden: reden || null,
    proef: v0 ? v0.proef : proefVoor(tegNaam, cfg),
    proef_eigenaar: v0 ? v0.proef_eigenaar : (proefVoor(tegNaam, cfg) ? ini.id : null),
    soort: a.vol ? "wachtlijst" : w.datum_nnb ? "inplannen" : "verzetten",
    vorige_id: v0?.id || null, ronde: v0 ? (v0.ronde || 1) + 1 : 1,
    vervalt_at: zelfdeDag ? nlMoment(nu.datum, VERVAL_ZELFDE_DAG_MIN) : null,
    bron: "app",
  };
  const { data: v, error } = await sb.from("verzet_voorstel").insert(rec).select("*").single();
  if (error) throw new Error(error.message);
  await meldVoorstel(v, w, ini.naam, teg?.id || null, tegNaam);
  await sluitMail();
  return { v, avond: a };
}

async function laadVoorstel(antwoord: unknown) {
  if (!isUuid(antwoord)) throw new Fout("Ongeldige link.", 401);
  const { data: v } = await sb.from("verzet_voorstel").select("*").eq("antwoord_token", antwoord).maybeSingle();
  if (!v) throw new Fout("Dit verzoek bestaat niet (meer).", 404);
  return v as any;
}
/** Is de wedstrijd sinds het voorstel door iemand anders gewijzigd? */
function gewijzigdSinds(v: any, w: any) {
  const oud = v.oude_datum ? String(v.oude_datum) : null;
  const nu = w.datum_nnb ? null : String(w.datum);
  return oud !== nu || gespeeld(w);
}

// ══════════════════════════════════════════
//  ACTIES
// ══════════════════════════════════════════
async function actieStatus(b: any) {
  const cfg = await config();
  const naam = String(b.naam || "");
  return { actief: !!naam && actiefVoor(naam, cfg), deadline: "10:00" };
}

async function voorstelSamenvatting(v: any, ikId: string) {
  const w = await wedstrijd(v.wedstrijd_id).catch(() => null);
  if (!w) return null;
  const van = await naamVan(v.initiator_id);
  return {
    id: v.id, status: v.status, soort: v.soort, ronde: v.ronde, proef: v.proef,
    wedstrijd_id: v.wedstrijd_id, thuis: w.thuis, uit: w.uit, divisie: w.divisie,
    oude_datum: v.oude_datum, nieuwe_datum: v.nieuwe_datum, van, door_mij: v.initiator_id === ikId,
    antwoord: v.initiator_id !== ikId || (v.proef && v.proef_eigenaar === ikId) ? v.antwoord_token : null,
    reden: v.reden, antwoord_reden: v.antwoord_reden, reden_keuze: v.reden_keuze,
    created_at: v.created_at, beantwoord_at: v.beantwoord_at, vervalt_at: v.vervalt_at,
  };
}

async function actieMijn(b: any) {
  const sp = await spelerVanCode(b.code, b.naam);
  const cfg = await config();
  const sinds = new Date(Date.now() - 3 * 86400000).toISOString();
  const [{ data: open }, { data: recent }] = await Promise.all([
    sb.from("verzet_voorstel").select("*").eq("status", "voorgesteld").or(`initiator_id.eq.${sp.id},tegenstander_id.eq.${sp.id}`).order("created_at", { ascending: false }),
    sb.from("verzet_voorstel").select("*").neq("status", "voorgesteld").eq("initiator_id", sp.id).gte("beantwoord_at", sinds).order("beantwoord_at", { ascending: false }).limit(10),
  ]);
  const voorMij: any[] = [], vanMij: any[] = [], uitslag: any[] = [];
  for (const v of open || []) {
    const s = await voorstelSamenvatting(v, sp.id); if (!s) continue;
    // In de test (proef) is de aanvrager ook degene die antwoordt.
    if (v.proef ? v.proef_eigenaar === sp.id : v.tegenstander_id === sp.id) voorMij.push(s);
    if (v.initiator_id === sp.id) vanMij.push(s);
  }
  for (const v of recent || []) {
    if (v.status === "tegenvoorstel") continue;
    const s = await voorstelSamenvatting(v, sp.id); if (s) uitslag.push(s);
  }
  const { data: later } = await sb.from("speler_acties").select("datum, tijd").eq("soort", "later").eq("speler_id", sp.id).gte("datum", nlNu().datum);
  return { speler: sp.naam, actief: actiefVoor(sp.naam, cfg), voor_mij: voorMij, van_mij: vanMij, uitslag, later: later || [] };
}

async function actieAvonden(b: any) {
  const cfg = await config();
  if (b.antwoord) {
    const v = await laadVoorstel(b.antwoord);
    if (v.status !== "voorgesteld") throw new Fout("Op dit verzoek is al gereageerd.");
    const w = await wedstrijd(v.wedstrijd_id);
    const ini = await naamVan(v.initiator_id);
    const ik = tegenstanderVan(w, ini || "");
    const avonden = (await avondenVoor(w, ik, cfg)).map((a) => ({ ...a, voorgesteld: a.datum === String(v.nieuwe_datum) }));
    return { avonden, ik, teg: ini, wedstrijd: { thuis: w.thuis, uit: w.uit, datum: w.datum_nnb ? null : w.datum } };
  }
  const sp = await spelerVanCode(b.code, b.naam);
  if (!actiefVoor(sp.naam, cfg)) throw new Fout("Verzetten via de app staat nog niet aan.", 403);
  if (!isUuid(b.wedstrijd_id)) throw new Fout("Geen wedstrijd gekozen.");
  const w = await wedstrijd(b.wedstrijd_id);
  const bz = bezwaar(w, sp.naam); if (bz) throw new Fout(bz);
  return { avonden: await avondenVoor(w, sp.naam, cfg), ik: sp.naam, teg: tegenstanderVan(w, sp.naam), wedstrijd: { thuis: w.thuis, uit: w.uit, datum: w.datum_nnb ? null : w.datum } };
}

async function actieVoorstel(b: any) {
  const sp = await spelerVanCode(b.code, b.naam);
  const cfg = await config();
  if (!actiefVoor(sp.naam, cfg)) throw new Fout("Verzetten via de app staat nog niet aan.", 403);
  if (!isUuid(b.wedstrijd_id)) throw new Fout("Geen wedstrijd gekozen.");
  if (!isDatum(b.datum)) throw new Fout("Kies een avond.");
  const w = await wedstrijd(b.wedstrijd_id);
  const bz = bezwaar(w, sp.naam); if (bz) throw new Fout(bz);
  const nu = nlNu();
  if (b.datum <= nu.datum) throw new Fout("Verzetten naar vanavond kan niet. Kies een latere avond.");
  const reden = String(b.reden || "").trim().slice(0, 300) || null;
  const { v, avond } = await maakVoorstel(w, sp, b.datum, reden, cfg);
  return { ok: true, voorstel_id: v.id, soort: v.soort, proef: v.proef, tegenstander: tegenstanderVan(w, sp.naam), avond, vervalt_at: v.vervalt_at };
}

async function actieBekijk(b: any) {
  const v = await laadVoorstel(b.antwoord);
  const cfg = await config();
  const w = await wedstrijd(v.wedstrijd_id);
  const van = await naamVan(v.initiator_id);
  const ik = tegenstanderVan(w, van || "");
  let avond = null;
  if (v.status === "voorgesteld") avond = (await avondenVoor(w, ik, cfg)).find((a) => a.datum === String(v.nieuwe_datum)) || null;
  const vorige = v.vorige_id ? (await sb.from("verzet_voorstel").select("nieuwe_datum, antwoord_reden").eq("id", v.vorige_id).maybeSingle()).data : null;
  return {
    status: v.status, soort: v.soort, proef: v.proef, ronde: v.ronde, mag_tegenvoorstel: (v.ronde || 1) < MAX_RONDES,
    van, ik, thuis: w.thuis, uit: w.uit, divisie: w.divisie, speelronde: w.speelronde || null,
    oude_datum: v.oude_datum, nieuwe_datum: v.nieuwe_datum, reden: v.reden, vervalt_at: v.vervalt_at,
    vorige_datum: vorige?.nieuwe_datum || null, avond, gewijzigd: gewijzigdSinds(v, w),
  };
}

async function sluitAf(v: any, status: string, extra: Record<string, unknown> = {}) {
  const { data, error } = await sb.from("verzet_voorstel").update({ status, beantwoord_at: new Date().toISOString(), ...extra })
    .eq("id", v.id).eq("status", "voorgesteld").select("id");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Fout("Op dit verzoek is al gereageerd.");
}

async function actieAntwoord(b: any) {
  return await verwerkAntwoord(await laadVoorstel(b.antwoord), b, false);
}

/** De WL zegt akkoord/afwijzen namens de tegenstander (bijv. na een mailtje of telefoontje). */
async function actieWlBesluit(b: any) {
  const { data: ok } = await sb.rpc("controleer_beheer_wachtwoord", { invoer: String(b.wachtwoord || "") });
  if (ok !== true) { await new Promise((r) => setTimeout(r, 800)); throw new Fout("Onjuist wachtwoord", 401); }
  if (!isUuid(b.id)) throw new Fout("Ongeldig verzoek.");
  const { data: v } = await sb.from("verzet_voorstel").select("*").eq("id", b.id).maybeSingle();
  if (!v) throw new Fout("Dit verzoek bestaat niet (meer).", 404);
  return await verwerkAntwoord(v, b, true);
}

async function verwerkAntwoord(v: any, b: any, viaWl: boolean) {
  if (v.status !== "voorgesteld") throw new Fout("Op dit verzoek is al gereageerd.");
  const besluit = b.besluit === "akkoord" ? "geaccepteerd" : b.besluit === "afwijzen" ? "afgewezen" : null;
  if (!besluit) throw new Fout("Kies akkoord of afwijzen.");
  const cfg = await config();
  const w = await wedstrijd(v.wedstrijd_id);
  const nu = nlNu();
  const ini = { id: v.initiator_id, naam: (await naamVan(v.initiator_id)) || "" };
  const tegNaam = tegenstanderVan(w, ini.naam);
  if (gewijzigdSinds(v, w)) {
    await sluitAf(v, "vervallen_door_wijziging");
    throw new Fout("De wedstrijd is intussen al gewijzigd. Dit verzoek is daarom vervallen.");
  }
  const reden = String(b.reden || "").trim().slice(0, 300) || null;
  const redenKeuze = String(b.reden_keuze || "").trim().slice(0, 60) || null;
  const oIni = await ontvanger(v, ini.id, ini.naam);
  const iniMails = await emailVan(oIni.id);
  const nieuw = datumKort(v.nieuwe_datum);

  if (besluit === "afgewezen") {
    await sluitAf(v, "afgewezen", { antwoord_reden: viaWl ? `[via WL] ${reden || ""}`.trim() : reden, reden_keuze: redenKeuze });
    const wat = [redenKeuze, reden].filter(Boolean).join(" · ");
    await push([oIni.naam], (v.proef ? "[TEST] " : "") + "❌ Verzoek afgewezen", `${voornaam(tegNaam)} kan niet op ${nieuw}${wat ? `: ${wat}` : "."} Stel een andere avond voor of app ${voornaam(tegNaam)}.`, "./?view=mijn", "verzet_antwoord");
    await mail({
      naar: iniMails, onderwerp: `Niet akkoord: ${w.thuis} vs ${w.uit}`, kopKlein: "Verzetten", kopGroot: "Je verzoek is afgewezen", accent: KLEUR.inhaal,
      rijen: tekstRij(`<p style="margin:0;"><strong>${esc(tegNaam)}</strong> kan helaas niet op ${esc(datumLang(v.nieuwe_datum))}.</p>`) +
        (wat ? detailKaart([["Reden", esc(wat)]], KLEUR.inhaal) : "") +
        tekstRij(`<span style="font-size:14px;color:${KLEUR.grijs};">De wedstrijd blijft staan zoals hij stond. Je kunt in de app een andere avond voorstellen of ${esc(voornaam(tegNaam))} appen.</span>`, "10px 24px 0 24px") +
        knop("Open de app", appUrl(oIni.naam)),
      tekst: `${tegNaam} kan niet op ${datumLang(v.nieuwe_datum)}.${wat ? `\nReden: ${wat}` : ""}\nDe wedstrijd blijft staan zoals hij stond.\n\nOpen de app: ${appUrl(oIni.naam)}`,
    });
    await sluitMail();
    return { ok: true, status: "afgewezen" };
  }

  // ── Akkoord ──
  if (v.vervalt_at && Date.now() > Date.parse(v.vervalt_at)) {
    await sluitAf(v, "verlopen");
    throw new Fout("Dit verzoek voor vandaag is verlopen (bevestigen kon tot 16:00).");
  }
  if (String(v.nieuwe_datum) < nu.datum) { await sluitAf(v, "verlopen"); throw new Fout("Die avond is al voorbij."); }
  const rijen = await avondRijen(String(v.nieuwe_datum));
  const totaal = rijen.filter((x) => x.id !== w.id).length;
  const naarWachtlijst = totaal >= cfg.MAX;
  await sluitAf(v, "geaccepteerd", { antwoord_reden: viaWl ? `[via WL] ${reden || ""}`.trim() : reden });
  const door = viaWl ? `${ini.naam} (app, akkoord ${tegNaam} via WL)` : `${ini.naam} (app, akkoord ${tegNaam})`;

  let tijd: string | null = null;
  if (!v.proef) {
    if (naarWachtlijst) {
      await sb.from("wachtlijst").upsert({ wedstrijd_id: w.id, datum: v.nieuwe_datum, door }, { onConflict: "wedstrijd_id,datum", ignoreDuplicates: true });
      await sb.from("wijziging_log").insert({
        wedstrijd_id: w.id, thuis: w.thuis, uit: w.uit, divisie: w.divisie || null, actie: "verzet",
        oude_datum: w.datum_nnb ? null : w.datum, nieuwe_datum: w.datum_nnb ? null : w.datum, oude_tijdstip: w.tijdstip, nieuwe_tijdstip: w.tijdstip,
        gewijzigd_door: door, notitie: `Op wachtlijst voor ${datumKort(v.nieuwe_datum)} (avond vol, via de app)`, mail_verstuurd: false,
      });
    } else {
      tijd = kiesSlot(w, rijen, cfg);
      const eersteKeerBeker = isBeker(w) && w.datum_nnb && !w.originele_datum && !w.is_inhaal;
      const inhaal = !eersteKeerBeker;
      const orig = inhaal ? (w.originele_datum || w.datum) : null;
      const { error } = await sb.from("wedstrijden").update({
        datum: v.nieuwe_datum, tijdstip: tijd, datum_nnb: false, is_inhaal: inhaal, originele_datum: orig, status: "gepland",
      }).eq("id", w.id);
      if (error) throw new Error(error.message);
      await sb.from("wachtlijst").delete().eq("wedstrijd_id", w.id);
      const { data: log } = await sb.from("wijziging_log").insert({
        wedstrijd_id: w.id, thuis: w.thuis, uit: w.uit, divisie: w.divisie || null, actie: "verzet",
        oude_datum: w.datum_nnb ? null : w.datum, nieuwe_datum: v.nieuwe_datum, oude_tijdstip: w.datum_nnb ? null : w.tijdstip, nieuwe_tijdstip: tijd,
        gewijzigd_door: door, notitie: "Verzet via de app", mail_verstuurd: false,
      }).select("id").single();
      // Gewone verzetmail + push aan beide spelers (zelfde als vanuit het dashboard)
      await fetch(`${SB_URL}/functions/v1/notify-wedstrijd`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE}` },
        body: JSON.stringify({ type: "verzet", wedstrijd_id: w.id, gewijzigd_door: door, wijziging_log_id: log?.id, oude_tijdstip: w.tijdstip, nieuwe_tijdstip: tijd }),
      }).catch((e) => console.error("notify-wedstrijd", e));
    }
  }
  // Aanvrager laten weten dat het akkoord is (de gewone verzetmail volgt apart; in test alleen dit bericht)
  const tekstAkkoord = naarWachtlijst
    ? `${voornaam(tegNaam)} is akkoord. ${nieuw} is vol, jullie staan op de wachtlijst. De wedstrijd blijft tot die tijd staan.`
    : `${voornaam(tegNaam)} is akkoord: jullie spelen op ${nieuw}. Je tijd zie je in de app.`;
  if (!v.proef && !naarWachtlijst && String(v.oude_datum) === nu.datum)
    await wlPush(cfg, `${w.thuis} – ${w.uit} speelt vanavond niet: verzet naar ${nieuw}.`, "📅 Verzet van vanavond");
  await push([oIni.naam], (v.proef ? "[TEST] " : "") + "✅ Akkoord", tekstAkkoord + (v.proef ? " (test: niets verzet)" : ""), "./?view=mijn", "verzet_antwoord");
  if (v.proef || naarWachtlijst) {
    await mail({
      naar: iniMails, onderwerp: `Akkoord: ${w.thuis} vs ${w.uit}`, kopKlein: "Verzetten", kopGroot: naarWachtlijst ? "Akkoord, jullie staan op de wachtlijst" : "Akkoord", accent: KLEUR.groen,
      rijen: tekstRij(`<p style="margin:0;">${esc(tekstAkkoord)}</p>`) + (v.proef ? tekstRij(`<span style="font-size:14px;color:${KLEUR.grijs};">Test: de wedstrijd is niet echt verzet.</span>`, "10px 24px 0 24px") : ""),
      tekst: tekstAkkoord + (v.proef ? "\nTest: de wedstrijd is niet echt verzet." : ""),
    });
  }
  await sluitMail();
  return { ok: true, status: "geaccepteerd", wachtlijst: naarWachtlijst, tijd, proef: v.proef };
}

async function actieTegenvoorstel(b: any) {
  const v = await laadVoorstel(b.antwoord);
  if (v.status !== "voorgesteld") throw new Fout("Op dit verzoek is al gereageerd.");
  if ((v.ronde || 1) >= MAX_RONDES) throw new Fout("Jullie zijn er via de app niet uitgekomen. App elkaar even om samen een avond te kiezen.");
  if (!isDatum(b.datum)) throw new Fout("Kies een avond.");
  const cfg = await config();
  const w = await wedstrijd(v.wedstrijd_id);
  if (gewijzigdSinds(v, w)) { await sluitAf(v, "vervallen_door_wijziging"); throw new Fout("De wedstrijd is intussen al gewijzigd. Dit verzoek is vervallen."); }
  const iniNaam = (await naamVan(v.initiator_id)) || "";
  const ikNaam = tegenstanderVan(w, iniNaam);
  const ik = await spelerOpNaam(ikNaam);
  if (!ik) throw new Fout("Speler niet gevonden.");
  const nu = nlNu();
  if (b.datum <= nu.datum) throw new Fout("Verzetten naar vanavond kan niet. Kies een latere avond.");
  const bz = bezwaar(w, ikNaam); if (bz) throw new Fout(bz);
  await sluitAf(v, "tegenvoorstel");
  const reden = String(b.reden || "").trim().slice(0, 300) || null;
  try {
    const { v: nieuw } = await maakVoorstel(w, ik, b.datum, reden, cfg, { vorige: v });
    return { ok: true, voorstel_id: nieuw.id, ronde: nieuw.ronde, vervalt_at: nieuw.vervalt_at, proef: nieuw.proef };
  } catch (e) {
    // Tegenvoorstel lukte niet: oude voorstel weer openzetten
    await sb.from("verzet_voorstel").update({ status: "voorgesteld", beantwoord_at: null }).eq("id", v.id);
    throw e;
  }
}

async function actieIntrekken(b: any) {
  const sp = await spelerVanCode(b.code, b.naam);
  if (!isUuid(b.voorstel_id)) throw new Fout("Geen verzoek gekozen.");
  const { data: v } = await sb.from("verzet_voorstel").select("*").eq("id", b.voorstel_id).maybeSingle();
  if (!v || v.initiator_id !== sp.id) throw new Fout("Dit verzoek is niet van jou.", 403);
  if (v.status !== "voorgesteld") throw new Fout("Dit verzoek loopt niet meer.");
  await sluitAf(v, "ingetrokken");
  const w = await wedstrijd(v.wedstrijd_id);
  const tegNaam = tegenstanderVan(w, sp.naam);
  if (!v.proef) {
    const zin = `${sp.naam} heeft het verzoek om jullie wedstrijd te verzetten ingetrokken. Alles blijft zoals het was.`;
    await push([tegNaam], "↩️ Verzoek ingetrokken", zin, "./?view=mijn", "verzet_antwoord");
    await mail({ naar: await emailVan(v.tegenstander_id), onderwerp: `Verzoek ingetrokken: ${w.thuis} vs ${w.uit}`, kopKlein: "Verzetten", kopGroot: "Verzoek ingetrokken", accent: KLEUR.grijs,
      rijen: tekstRij(`<p style="margin:0;">${esc(zin)}</p>`), tekst: zin });
    await sluitMail();
  }
  return { ok: true };
}

async function actieAfmelden(b: any) {
  const sp = await spelerVanCode(b.code, b.naam);
  const cfg = await config();
  if (!actiefVoor(sp.naam, cfg)) throw new Fout("Afmelden via de app staat nog niet aan.", 403);
  if (!isDatum(b.datum)) throw new Fout("Kies een avond.");
  const ids: string[] = Array.isArray(b.wedstrijd_ids) ? b.wedstrijd_ids.filter(isUuid) : [];
  if (!ids.length) throw new Fout("Kies minstens één wedstrijd.");
  const nu = nlNu();
  const { data: ws } = await sb.from("wedstrijden").select("*").in("id", ids);
  const lijst = (ws || []).filter((w: any) => String(w.datum) === b.datum && !w.datum_nnb);
  if (lijst.length !== ids.length) throw new Fout("Een of meer wedstrijden staan niet (meer) op deze avond. Ververs de app.");
  for (const w of lijst) { const bz = bezwaar(w, sp.naam, nu, true); if (bz) throw new Fout(bz); }
  const proef = lijst.some((w: any) => proefVoor(tegenstanderVan(w, sp.naam), cfg));
  const door = `${sp.naam} (afgemeld via de app)`;
  for (const w of lijst) {
    const tegNaam = tegenstanderVan(w, sp.naam);
    if (!proef) {
      await sb.from("wedstrijden").update({ datum_nnb: true, is_inhaal: true, originele_datum: w.originele_datum || w.datum }).eq("id", w.id);
      await sb.from("wijziging_log").insert({
        wedstrijd_id: w.id, thuis: w.thuis, uit: w.uit, divisie: w.divisie || null, actie: "verzet",
        oude_datum: w.datum, nieuwe_datum: null, oude_tijdstip: w.tijdstip, nieuwe_tijdstip: w.tijdstip,
        gewijzigd_door: door, notitie: "Afgemeld via de app (NNB)", mail_verstuurd: false,
      });
      // Lopende verzoeken voor deze wedstrijd vervallen
      await sb.from("verzet_voorstel").update({ status: "vervallen_door_wijziging", beantwoord_at: new Date().toISOString() }).eq("wedstrijd_id", w.id).eq("status", "voorgesteld");
    }
    const naar = proef ? sp.naam : tegNaam;
    const zin = `${sp.naam} heeft zich afgemeld voor ${datumKort(w.datum)}. Jullie wedstrijd staat nu op NNB. Spreek samen een nieuwe avond af.`;
    await push([naar], (proef ? "[TEST] " : "") + "🚫 Afmelding", zin, "./?view=mijn", "afmelding");
    const t = proef ? sp : await spelerOpNaam(tegNaam);
    await mail({
      naar: await emailVan(t?.id || null), proefVoor: proef ? tegNaam : null,
      onderwerp: `Afmelding: ${w.thuis} vs ${w.uit} (${datumKort(w.datum)})`, kopKlein: "Afmelding", kopGroot: "Je tegenstander heeft zich afgemeld", accent: KLEUR.inhaal,
      rijen: tekstRij(`<p style="margin:0 0 12px 0;">Beste ${esc(voornaam(tegNaam))},</p><p style="margin:0;"><strong>${esc(sp.naam)}</strong> kan niet op ${esc(datumLang(w.datum))}. Jullie wedstrijd staat nu op <strong>NNB</strong> (nog niet bekend).</p>`) +
        tekstRij(`<span style="font-size:14px;color:${KLEUR.grijs};">Spreek samen een nieuwe avond af. In de app kun je je tegenstander appen of zelf een avond voorstellen.</span>`, "10px 24px 0 24px") +
        knop("Open de app", appUrl(t?.naam || tegNaam)),
      tekst: `${sp.naam} kan niet op ${datumLang(w.datum)}. Jullie wedstrijd staat nu op NNB. Spreek samen een nieuwe avond af.\n\nOpen de app: ${appUrl(t?.naam || tegNaam)}`,
    });
  }
  await sb.from("speler_acties").insert({ soort: "afmelding", speler_id: sp.id, datum: b.datum, wedstrijd_ids: lijst.map((w: any) => w.id) });
  // WL direct een melding bij afmelden voor vandaag of morgen
  if (b.datum === nu.datum || b.datum === plusDagen(nu.datum, 1)) {
    const wanneer = b.datum === nu.datum ? "vanavond" : "morgen";
    await wlPush(cfg, `${proef ? "[TEST] " : ""}${sp.naam} meldt zich af voor ${wanneer}. ${lijst.length} wedstrijd${lijst.length > 1 ? "en" : ""} op NNB.`, "🚫 Afmelding");
  }
  await sluitMail();
  return { ok: true, aantal: lijst.length, proef };
}

async function actieLater(b: any) {
  const sp = await spelerVanCode(b.code, b.naam);
  const cfg = await config();
  if (!actiefVoor(sp.naam, cfg)) throw new Fout("Deze knop staat nog niet aan.", 403);
  const tijd = String(b.tijd || "");
  if (!/^\d{2}:\d{2}$/.test(tijd)) throw new Fout("Kies hoe laat je er bent.");
  const nu = nlNu();
  const datum = isDatum(b.datum) ? String(b.datum) : nu.datum;
  // Vanaf de vrijdag vóór de speelavond (6 dagen vooruit) t/m de speelavond zelf
  if (datum < nu.datum || datum > plusDagen(nu.datum, LATER_DAGEN_VOORUIT)) throw new Fout("Doorgeven kan vanaf de vrijdag vóór je speelavond.");
  const mijnAvond = (await avondRijen(datum)).filter((w: any) => (w.thuis === sp.naam || w.uit === sp.naam) && !gespeeld(w));
  if (!mijnAvond.length) throw new Fout("Je hebt op die avond geen wedstrijden (meer).");
  await sb.from("speler_acties").delete().eq("soort", "later").eq("speler_id", sp.id).eq("datum", datum);
  await sb.from("speler_acties").insert({ soort: "later", speler_id: sp.id, datum, wedstrijd_ids: mijnAvond.map((w: any) => w.id), tijd });
  const dag = datum === nu.datum ? "vanavond" : datumKort(datum);
  const tegen = mijnAvond.map((w: any) => voornaam(tegenstanderVan(w, sp.naam))).join(", ");
  if (datum === nu.datum || datum === plusDagen(nu.datum, 1))
    await wlPush(cfg, `${sp.naam} is er ${dag} rond ${tijd}. Tegen ${tegen}.`, "⏰ Later aanwezig");
  for (const w of mijnAvond) {
    const teg = tegenstanderVan(w, sp.naam);
    if (proefVoor(teg, cfg)) continue;
    const zin = `${sp.naam} is er ${dag} rond ${tijd}. De wedstrijdleiding houdt er rekening mee bij het indelen.`;
    await push([teg], "⏰ Tegenstander later", zin, "./?view=mijn", "later");
    const t = await spelerOpNaam(teg);
    await mail({ naar: await emailVan(t?.id || null), onderwerp: `Je tegenstander is later: ${w.thuis} vs ${w.uit} (${datumKort(datum)})`, kopKlein: "Speelavond", kopGroot: "Je tegenstander is wat later",
      rijen: tekstRij(`<p style="margin:0 0 12px 0;">Beste ${esc(voornaam(teg))},</p><p style="margin:0;">${esc(zin)}</p>`), tekst: `Beste ${voornaam(teg)},\n\n${zin}` });
  }
  await sluitMail();
  return { ok: true, datum, tijd };
}

async function actieLaterIntrekken(b: any) {
  const sp = await spelerVanCode(b.code, b.naam);
  const cfg = await config();
  if (!isDatum(b.datum)) throw new Fout("Geen avond gekozen.");
  const nu = nlNu();
  const { data } = await sb.from("speler_acties").delete().eq("soort", "later").eq("speler_id", sp.id).eq("datum", b.datum).select("id");
  if (data?.length && (b.datum === nu.datum || b.datum === plusDagen(nu.datum, 1)))
    await wlPush(cfg, `${sp.naam} is ${b.datum === nu.datum ? "vanavond" : "morgen"} toch gewoon op tijd.`, "⏰ Toch op tijd");
  await sluitMail();
  return { ok: true };
}

// ── Elk uur via cron: herinneren en laten vervallen ──
async function actieOpvolging() {
  const nu = nlNu();
  const { data: open } = await sb.from("verzet_voorstel").select("*").eq("status", "voorgesteld");
  let herinnerd = 0, verlopen = 0;
  for (const v of (open || []) as any[]) {
    const dagen = (Date.now() - Date.parse(v.created_at)) / 86400000;
    const w = await wedstrijd(v.wedstrijd_id).catch(() => null);
    if (!w) continue;
    const ini = (await naamVan(v.initiator_id)) || "";
    const tegNaam = tegenstanderVan(w, ini);
    const verlooptNu = (v.vervalt_at && Date.now() > Date.parse(v.vervalt_at)) || String(v.nieuwe_datum) < nu.datum || dagen >= VERVAL_NA_DAGEN;
    if (gewijzigdSinds(v, w)) {
      await sb.from("verzet_voorstel").update({ status: "vervallen_door_wijziging", beantwoord_at: new Date().toISOString() }).eq("id", v.id).eq("status", "voorgesteld");
      continue;
    }
    if (verlooptNu) {
      await sb.from("verzet_voorstel").update({ status: "verlopen", beantwoord_at: new Date().toISOString() }).eq("id", v.id).eq("status", "voorgesteld");
      const oI = await ontvanger(v, v.initiator_id, ini);
      await push([oI.naam], (v.proef ? "[TEST] " : "") + "⌛ Verzoek vervallen", `${voornaam(tegNaam)} heeft niet gereageerd op je verzoek (${datumKort(v.nieuwe_datum)}). Alles blijft zoals het was. App ${voornaam(tegNaam)} even.`, "./?view=mijn", "verzet_antwoord");
      await mail({
        naar: await emailVan(oI.id), onderwerp: `Verzoek vervallen: ${w.thuis} vs ${w.uit}`, kopKlein: "Verzetten", kopGroot: "Verzoek vervallen", accent: KLEUR.grijs,
        rijen: tekstRij(`<p style="margin:0;">Op je verzoek om <strong>${esc(w.thuis)} – ${esc(w.uit)}</strong> te verplaatsen naar ${esc(datumLang(v.nieuwe_datum))} is geen reactie gekomen. Het verzoek is vervallen; de wedstrijd blijft staan zoals hij stond.</p>`),
        tekst: `Op je verzoek om ${w.thuis} - ${w.uit} te verplaatsen naar ${datumLang(v.nieuwe_datum)} is geen reactie gekomen. Het verzoek is vervallen.`,
      });
      verlopen++;
    } else if (dagen >= HERINNER_NA_DAGEN && !v.herinnerd_at) {
      await sb.from("verzet_voorstel").update({ herinnerd_at: new Date().toISOString() }).eq("id", v.id);
      const oT = await ontvanger(v, v.tegenstander_id, tegNaam);
      const naarId = oT.id;
      await push([oT.naam], (v.proef ? "[TEST] " : "") + "⏳ Er wacht een verzoek op je", `${voornaam(ini)} vroeg of jullie wedstrijd naar ${datumKort(v.nieuwe_datum)} kan. Tik om te reageren.`, `./?aanvraag=${v.antwoord_token}`, "verzet_aanvraag");
      await mail({
        naar: await emailVan(naarId), proefVoor: oT.test ? tegNaam : null,
        onderwerp: `Herinnering: verzoek van ${ini}`, kopKlein: "Herinnering", kopGroot: "Er wacht nog een verzoek op je",
        rijen: tekstRij(`<p style="margin:0;"><strong>${esc(ini)}</strong> vroeg ${Math.floor(dagen)} dagen geleden of jullie wedstrijd naar <strong>${esc(datumLang(v.nieuwe_datum))}</strong> kan. Laat je even weten of dat past?</p>`) +
          knop("Bekijken en reageren", aanvraagUrl(v.antwoord_token)) +
          tekstRij(`<span style="font-size:14px;color:${KLEUR.grijs};">Zonder reactie vervalt het verzoek na ${VERVAL_NA_DAGEN} dagen.</span>`, "10px 24px 0 24px"),
        tekst: `${ini} vroeg of jullie wedstrijd naar ${datumLang(v.nieuwe_datum)} kan.\nBekijken en reageren: ${aanvraagUrl(v.antwoord_token)}`,
      });
      herinnerd++;
    }
  }
  await sluitMail();
  return { ok: true, open: (open || []).length, herinnerd, verlopen };
}

// ── Overzicht voor de WL-app ──
async function actieWlOverzicht(b: any) {
  const { data: ok } = await sb.rpc("controleer_beheer_wachtwoord", { invoer: String(b.wachtwoord || "") });
  if (ok !== true) { await new Promise((r) => setTimeout(r, 800)); throw new Fout("Onjuist wachtwoord", 401); }
  const sinds = new Date(Date.now() - 7 * 86400000).toISOString();
  const [{ data: open }, { data: klaar }, { data: acties }, { data: sps }] = await Promise.all([
    sb.from("verzet_voorstel").select("*").eq("status", "voorgesteld").order("created_at", { ascending: true }),
    sb.from("verzet_voorstel").select("*").neq("status", "voorgesteld").neq("status", "tegenvoorstel").gte("beantwoord_at", sinds).order("beantwoord_at", { ascending: false }).limit(60),
    sb.from("speler_acties").select("*").gte("created_at", sinds).order("created_at", { ascending: false }).limit(60),
    sb.from("spelers").select("id, naam"),
  ]);
  const naam = new Map((sps || []).map((s: any) => [s.id, s.naam]));
  const ids = [...new Set([...(open || []), ...(klaar || [])].map((v: any) => v.wedstrijd_id))];
  const { data: ws } = ids.length ? await sb.from("wedstrijden").select("id, thuis, uit, divisie, datum, datum_nnb").in("id", ids) : { data: [] };
  const wm = new Map((ws || []).map((w: any) => [w.id, w]));
  const rij = (v: any) => {
    const w: any = wm.get(v.wedstrijd_id) || {};
    return { id: v.id, status: v.status, soort: v.soort, ronde: v.ronde, proef: v.proef, thuis: w.thuis, uit: w.uit, divisie: w.divisie,
      van: naam.get(v.initiator_id) || "?", oude_datum: v.oude_datum, nieuwe_datum: v.nieuwe_datum, created_at: v.created_at,
      beantwoord_at: v.beantwoord_at, vervalt_at: v.vervalt_at, reden_keuze: v.reden_keuze,
      via_wl: String(v.antwoord_reden || "").startsWith("[via WL]") };
  };
  // Afmeldingen alleen tonen zolang er nog wedstrijden van op NNB staan (opnieuw ingepland = klaar)
  const afIds = [...new Set((acties || []).filter((a: any) => a.soort === "afmelding").flatMap((a: any) => a.wedstrijd_ids || []))];
  const { data: nogNnb } = afIds.length ? await sb.from("wedstrijden").select("id").in("id", afIds).eq("datum_nnb", true) : { data: [] };
  const nnb = new Set((nogNnb || []).map((x: any) => x.id));
  const lijstActies = (acties || []).map((a: any) => {
    const ids = (a.wedstrijd_ids || []) as string[];
    const aantal = a.soort === "afmelding" ? ids.filter((i) => nnb.has(i)).length : ids.length;
    return { id: a.id, soort: a.soort, speler: naam.get(a.speler_id) || "?", datum: a.datum, tijd: a.tijd, aantal, created_at: a.created_at };
  }).filter((a: any) => a.soort !== "afmelding" || a.aantal > 0);
  return { open: (open || []).map(rij), afgehandeld: (klaar || []).map(rij), acties: lijstActies };
}

async function isSysteem(req: Request) {
  if (req.headers.get("Authorization") === `Bearer ${SERVICE}`) return true;
  const cron = req.headers.get("x-cron-secret");
  if (!cron) return false;
  const { data } = await sb.rpc("controleer_cron_sleutel", { invoer: cron });
  return data === true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Alleen POST" }, 405);
  try {
    const b = await req.json().catch(() => ({}));
    switch (b.actie) {
      case "status": return json(await actieStatus(b));
      case "mijn": return json(await actieMijn(b));
      case "avonden": return json(await actieAvonden(b));
      case "voorstel": return json(await actieVoorstel(b));
      case "bekijk": return json(await actieBekijk(b));
      case "antwoord": return json(await actieAntwoord(b));
      case "tegenvoorstel": return json(await actieTegenvoorstel(b));
      case "intrekken": return json(await actieIntrekken(b));
      case "afmelden": return json(await actieAfmelden(b));
      case "later": return json(await actieLater(b));
      case "later_intrekken": return json(await actieLaterIntrekken(b));
      case "wl_overzicht": return json(await actieWlOverzicht(b));
      case "wl_besluit": return json(await actieWlBesluit(b));
      case "opvolging":
        if (!(await isSysteem(req))) return json({ error: "niet toegestaan" }, 401);
        return json(await actieOpvolging());
      default: return json({ error: "Onbekende actie" }, 400);
    }
  } catch (e) {
    await sluitMail();
    if (e instanceof Fout) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: "Er ging iets mis. Probeer het later opnieuw." }, 500);
  }
});
