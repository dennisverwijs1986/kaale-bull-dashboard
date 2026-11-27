# Printerlogboek (alpha)

Testversie van het printerlogboek voor Nonstop Printing. Staat los van het Kaale Bull-dashboard: eigen map, eigen branch (`nonstop-alpha`) en een eigen Supabase-project (`nonstop`, regio Frankfurt).

## Wat erin zit

- Overzicht van alle printers met status, per printer een eigen pagina (swipen tussen printers)
- Dagelijkse testprint uploaden (foto) en beoordelen: goed, afwijking of afgekeurd
- Storingen melden, voortgang bijhouden, oplossing vastleggen (intern of monteur), zoeken in alle storingen
- Berichten per printer, met "Dit werkte" en "Maak er een storing van"
- Monteur inschakelen: kant-en-klaar bericht uit storing, voortgang en berichten, te versturen via WhatsApp of e-mail
- Inloggen met e-mail en wachtwoord; alleen mensen in de tabel `members` zien en schrijven iets

Nog niet in de alpha: AI-suggesties, automatisch mailen naar monteurs, import uit WhatsApp, back-up naar de NAS.

## Database

Supabase-project `nonstop` (`uqyluxodmnuctynycsmm`). Tabellen: `members`, `machines`, `testprints`, `issues`, `issue_notes`, `messages`, plus de privé-opslagmap `testprints` voor foto's. Het volledige schema staat in `schema.sql`.

Wie iets schrijft en wanneer, vult de database zelf in (triggers), zodat niemand dat in de app kan vervalsen.

## Tester toevoegen

In Supabase: Table Editor, tabel `members`, nieuwe rij met het e-mailadres (kleine letters), naam en rol `operator` (of `beheer` voor iemand die machines en leden mag beheren). De tester maakt daarna in de app een account aan met hetzelfde e-mailadres.

## Eenmalig instellen in Supabase

Authentication, URL Configuration: zet de Site URL op het adres waar de app draait. Anders verwijst de bevestigingslink in de welkomstmail naar een lege pagina (het account wordt wel bevestigd).

## Updates

De app controleert zelf (bij openen, bij terugkeren naar de app en elke 5 minuten) of er een nieuwe versie is, via `version.json`. Is die anders dan `APP_VERSION` in `index.html`, dan herlaadt de app vanzelf, behalve als iemand op dat moment iets aan het invullen is. **Bij elke wijziging: verhoog de versie in beide bestanden naar dezelfde waarde**, anders merken telefoons met de app op het beginscherm de update pas na een tijd op.
