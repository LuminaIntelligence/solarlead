-- LinkedIn-Default-Template auf den Email-Erstkontakt-Stil umstellen.
-- Identische Tonalität wie die Email-Erstkontakt-Mail, nur ohne
-- Abmelde-Hinweis und mit "Herzliche Grüße" statt "Mit freundlichen
-- Grüßen". Signatur wird komplett ausgeschrieben (kein HTML-Logo).

UPDATE linkedin_templates
SET
  subject = 'Ihre Dachfläche — kurze Anfrage zur Anpachtung',
  body = E'Guten Tag {salutation_lastname},\n\n' ||
         E'mein Name ist Sebastian Trautschold, ich bin Vorstand der GreenScout e.V. und über einen unserer Mitglieder bin ich auf Ihre Dachfläche aufmerksam gemacht worden.\n\n' ||
         E'Nach meiner Ersteinschätzung wäre Ihre Dachfläche zur Anpachtung geeignet.\n' ||
         E'Gern würde ich mich hierzu einmal austauschen. Bei der Dachgröße von {roof_m2_formatted} m² würde eine Pacht von rund {lease} € für Sie zu erzielen sein.\n\n' ||
         E'Wenn das für Sie grundsätzlich interessant ist, erläutere ich Ihnen das gerne in einem kurzen Termin von 15–20 Minuten telefonisch.\n' ||
         E'Passt es Ihnen eher Anfang oder Ende der Woche?\n\n' ||
         E'Herzliche Grüße\n' ||
         E'Sebastian Trautschold\n' ||
         E'Vorstand\n\n' ||
         E'Telefon: 038875 169780\n' ||
         E'E-Mail: sebastian.trautschold@greenscout-ev.de\n' ||
         E'Internet: https://www.greenscout-ev.de\n\n' ||
         E'GreenScout e.V.\n' ||
         E'Utechter Str. 5\n' ||
         E'19217 Utecht',
  updated_at = now()
WHERE name = 'Solar-Pacht-Standard';

-- Falls die Default-Vorlage nicht existiert (frischer Tenant), einfügen
INSERT INTO linkedin_templates (name, subject, body, is_default, is_active)
SELECT
  'Solar-Pacht-Standard',
  'Ihre Dachfläche — kurze Anfrage zur Anpachtung',
  E'Guten Tag {salutation_lastname},\n\n' ||
  E'mein Name ist Sebastian Trautschold, ich bin Vorstand der GreenScout e.V. und über einen unserer Mitglieder bin ich auf Ihre Dachfläche aufmerksam gemacht worden.\n\n' ||
  E'Nach meiner Ersteinschätzung wäre Ihre Dachfläche zur Anpachtung geeignet.\n' ||
  E'Gern würde ich mich hierzu einmal austauschen. Bei der Dachgröße von {roof_m2_formatted} m² würde eine Pacht von rund {lease} € für Sie zu erzielen sein.\n\n' ||
  E'Wenn das für Sie grundsätzlich interessant ist, erläutere ich Ihnen das gerne in einem kurzen Termin von 15–20 Minuten telefonisch.\n' ||
  E'Passt es Ihnen eher Anfang oder Ende der Woche?\n\n' ||
  E'Herzliche Grüße\n' ||
  E'Sebastian Trautschold\n' ||
  E'Vorstand\n\n' ||
  E'Telefon: 038875 169780\n' ||
  E'E-Mail: sebastian.trautschold@greenscout-ev.de\n' ||
  E'Internet: https://www.greenscout-ev.de\n\n' ||
  E'GreenScout e.V.\n' ||
  E'Utechter Str. 5\n' ||
  E'19217 Utecht',
  true,
  true
WHERE NOT EXISTS (SELECT 1 FROM linkedin_templates WHERE name = 'Solar-Pacht-Standard');
