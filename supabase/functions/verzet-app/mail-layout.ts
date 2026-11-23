// Gedeelde opmaak voor spelersmails van De Kaale Bull (dashboard-stijl: navy + blauw).
// Ingekorte kopie van de mail-layout uit de andere mailfuncties.

export const KLEUR = {
  navy: "#0f1520",
  blauw: "#3b82f6",
  tekst: "#1e293b",
  grijs: "#64748b",
  lijn: "#e2e8f0",
  zacht: "#eff6ff",
  ere: "#a855f7",
  eerste: "#3b82f6",
  beker: "#f59e0b",
  inhaal: "#ef4444",
  groen: "#10b981",
};

export function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)
  );
}

const MAANDEN_KORT = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
const MAANDEN_LANG = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];
const DAGEN_KORT = ["zo", "ma", "di", "wo", "do", "vr", "za"];
const DAGEN_LANG = ["zondag", "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag"];

function delen(datum: string) {
  const [y, m, d] = String(datum).split("-").map(Number);
  const dag = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return { y, m, d, dag };
}

/** "do 5 nov" */
export function datumKort(datum: string | null): string {
  if (!datum) return "nog niet gepland";
  const { m, d, dag } = delen(datum);
  return `${DAGEN_KORT[dag]} ${d} ${MAANDEN_KORT[m - 1]}`;
}

/** "donderdag 1 oktober" */
export function datumLang(datum: string | null): string {
  if (!datum) return "nog niet gepland";
  const { m, d, dag } = delen(datum);
  return `${DAGEN_LANG[dag]} ${d} ${MAANDEN_LANG[m - 1]}`;
}

export function tekstRij(html: string, pad = "20px 24px 6px 24px"): string {
  return `<tr><td style="padding:${pad};font-size:16px;line-height:1.55;">${html}</td></tr>`;
}

/** Kaart met label/waarde-regels. Waarden zijn html (zelf escapen). */
export function detailKaart(regels: [string, string][], kleur: string = KLEUR.blauw): string {
  const inhoud = regels.map(([k, v]) =>
    `<tr><td style="padding:6px 0;color:${KLEUR.grijs};font-size:14px;width:130px;vertical-align:top;">${esc(k)}</td><td style="padding:6px 0;font-size:16px;">${v}</td></tr>`
  ).join("");
  return `<tr><td style="padding:12px 24px 6px 24px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${KLEUR.zacht};border-left:4px solid ${kleur};border-radius:6px;"><tr><td style="padding:12px 16px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${inhoud}</table></td></tr></table></td></tr>`;
}

export const knop = (tekst: string, href: string, kleur = KLEUR.blauw) =>
  `<tr><td style="padding:14px 24px 4px 24px;"><a href="${esc(href)}" style="display:block;background:${kleur};color:#ffffff;text-decoration:none;font-size:17px;font-weight:bold;text-align:center;padding:14px 12px;border-radius:8px;">${esc(tekst)}</a></td></tr>`;

/** Volledige mail: navy kop met gekleurde lijn, inhoudsrijen, groet. */
export function mailHtml(opts: { kopKlein: string; kopGroot: string; accent?: string; rijen: string }): string {
  const accent = opts.accent || KLEUR.blauw;
  return `<!DOCTYPE html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#e2e8f0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#e2e8f0;"><tr><td align="center" style="padding:20px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:10px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;color:${KLEUR.tekst};">
  <tr><td style="background:${KLEUR.navy};padding:22px 24px;border-bottom:4px solid ${accent};">
    <div style="font-size:12px;color:#94a3b8;letter-spacing:1.5px;text-transform:uppercase;font-weight:bold;">🎯 De Kaale Bull · ${esc(opts.kopKlein)}</div>
    <div style="font-size:22px;color:#ffffff;font-weight:bold;margin-top:6px;">${esc(opts.kopGroot)}</div>
  </td></tr>
  ${opts.rijen}
  <tr><td style="padding:16px 24px 24px 24px;font-size:16px;line-height:1.55;">Met sportieve groet,<br>Wedstrijdleiding De Kaale Bull</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

export const GROET_TEKST = "\n\nMet sportieve groet,\nWedstrijdleiding De Kaale Bull";
