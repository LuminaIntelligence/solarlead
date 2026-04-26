import {
  ScoringInput,
  ScoringWeights,
  ScoringBreakdown,
  DEFAULT_WEIGHTS,
} from './types';

// --- Kategorie-Labels ---

const CATEGORY_LABELS: Record<string, string> = {
  // Logistik & Handel
  logistics:       'Logistik',
  warehouse:       'Lager / Halle',
  cold_storage:    'Kühlhaus',
  wholesale:       'Großhandel',
  supermarket:     'Supermarkt',
  shopping_center: 'Einkaufszentrum',
  hardware_store:  'Baumarkt',
  furniture_store: 'Möbelhaus',
  car_dealership:  'Autohaus',
  // Industrie & Produktion
  manufacturing:   'Fertigung',
  metalworking:    'Metallverarbeitung',
  food_production: 'Lebensmittelproduktion',
  wood_processing: 'Holzverarbeitung',
  plastics:        'Kunststofftechnik',
  printing:        'Druckerei',
  brewery:         'Brauerei / Getränke',
  recycling:       'Recycling / Entsorgung',
  // Agrar
  farm:            'Landwirtschaft',
  greenhouse:      'Gewächshaus / Gärtnerei',
  // Öffentlich & Sozial
  hospital:        'Klinik / Krankenhaus',
  swimming_pool:   'Hallenbad / Freibad',
  sports_hall:     'Sporthalle',
  school:          'Schule / Bildung',
  events_hall:     'Veranstaltungshalle',
  church:          'Kirche / Gemeinde',
  // Dienstleistungen
  hotel:           'Hotel',
  laundry:         'Wäscherei',
  data_center:     'Rechenzentrum',
  gas_station:     'Tankstelle',
  car_park:        'Parkhaus',
};

function formatCategory(category: string): string {
  return CATEGORY_LABELS[category] ?? category
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// --- Unternehmenseignung (Business Score) ---

const BUSINESS_SCORES: Record<string, { score: number; label: string }> = {
  // Logistik & Handel
  cold_storage:    { score: 95, label: 'Große Flachdachfläche, sehr hoher Energiebedarf (24/7 Kühlung)' },
  warehouse:       { score: 92, label: 'Große Flachdachfläche ideal für Solaranlagen' },
  logistics:       { score: 90, label: 'Große Dachfläche mit erheblichem Energieverbrauch' },
  wholesale:       { score: 82, label: 'Große Hallendächer, hoher Eigenverbrauchspotenzial' },
  shopping_center: { score: 72, label: 'Große Dachfläche, mittlerer bis hoher Energieverbrauch' },
  supermarket:     { score: 75, label: 'Konstanter Energieverbrauch mit guter Dachfläche' },
  hardware_store:  { score: 65, label: 'Gute Dachfläche mit moderatem Energiebedarf' },
  furniture_store: { score: 63, label: 'Große Ausstellungsdächer geeignet für Solar' },
  car_dealership:  { score: 60, label: 'Energiebedarf für Ausstellung und Beleuchtung' },
  // Industrie & Produktion
  manufacturing:   { score: 85, label: 'Hoher Energieverbrauch, oft große Flachdachfläche' },
  metalworking:    { score: 83, label: 'Energieintensive Produktion mit gutem Dachpotenzial' },
  food_production: { score: 80, label: 'Hoher Energiebedarf durch Verarbeitung und Kühlung' },
  recycling:       { score: 85, label: 'Große Hallenflächen, energieintensiver Betrieb' },
  wood_processing: { score: 82, label: 'Große Produktionshallen mit guten Dachflächen' },
  plastics:        { score: 80, label: 'Energieintensive Fertigung, gute Dacheitgung' },
  brewery:         { score: 78, label: 'Hoher Energiebedarf für Produktion und Kühlung' },
  printing:        { score: 75, label: 'Hoher Stromverbrauch durch Druckmaschinen' },
  // Agrar
  farm:            { score: 93, label: 'Sehr große Stalldächer und Scheunen, ideale Flachdachflächen' },
  greenhouse:      { score: 72, label: 'Hoher Energiebedarf für Heizung und Beleuchtung' },
  // Öffentlich & Sozial
  data_center:     { score: 95, label: 'Extrem hoher Stromverbrauch, 24/7 Betrieb' },
  hospital:        { score: 88, label: 'Sehr hoher Energiebedarf, große Dachflächen' },
  swimming_pool:   { score: 87, label: 'Hoher Energiebedarf für Heizung und Pumpen, große Dachfläche' },
  sports_hall:     { score: 83, label: 'Große Flachdachfläche, moderater bis hoher Energiebedarf' },
  events_hall:     { score: 80, label: 'Sehr große Hallendächer, hoher Spitzenbedarf' },
  school:          { score: 68, label: 'Gute Flachdachfläche, politischer Wille zur Solarisierung' },
  church:          { score: 48, label: 'Oft große Dachflächen, niedriger Eigenverbrauch' },
  // Dienstleistungen
  laundry:         { score: 88, label: 'Sehr hoher Energiebedarf durch Waschmaschinen und Trockner' },
  hotel:           { score: 55, label: 'Mittlere Dachfläche, ganzjähriger Energiebedarf' },
  car_park:        { score: 72, label: 'Große Dachflächen (Carport-Solar), wachsende E-Ladeinfrastruktur' },
  gas_station:     { score: 55, label: 'Überdachung als Solardach nutzbar, moderater Eigenverbrauch' },
};

function calculateBusinessScore(category: string): { score: number; explanation: string } {
  const entry = BUSINESS_SCORES[category];
  if (entry) {
    return {
      score: entry.score,
      explanation: `Kategorie „${formatCategory(category)}": ${entry.label} (Score ${entry.score}/100).`,
    };
  }
  return {
    score: 40,
    explanation: `Kategorie „${formatCategory(category)}" hat begrenzte bekannte Solar-Eignung (Score 40/100).`,
  };
}

// --- Stromverbrauch (Electricity Score) ---

const ELECTRICITY_SCORES: Record<string, { score: number; label: string }> = {
  cold_storage:     { score: 95, label: '24/7 Kühlung verursacht sehr hohen Verbrauch' },
  manufacturing:    { score: 90, label: 'Schwere Maschinen und Prozessenergie' },
  metalworking:     { score: 90, label: 'Industrielle Hochleistungsgeräte' },
  food_production:  { score: 85, label: 'Produktionslinien plus Kühlung' },
  supermarket:      { score: 80, label: 'Beleuchtung, Kühlung, Klimaanlage rund um die Uhr' },
  shopping_center:  { score: 75, label: 'Umfangreiche Beleuchtung und Klimatisierung' },
  warehouse:        { score: 70, label: 'Beleuchtung und Materialhandhabung' },
  logistics:        { score: 70, label: 'Sortiersysteme und Potenzial für Flottenladung' },
  hotel:            { score: 65, label: 'Klimaanlage, Wäscherei, Küche und Gästeservice' },
  hardware_store:   { score: 55, label: 'Einzelhandelsbeleuchtung und moderate Klimatisierung' },
  furniture_store:  { score: 55, label: 'Ausstellungsbeleuchtung und Klimatisierung' },
  car_dealership:   { score: 50, label: 'Ausstellungs- und Außenbeleuchtung, moderat insgesamt' },
};

function calculateElectricityScore(category: string): { score: number; explanation: string } {
  const entry = ELECTRICITY_SCORES[category];
  if (entry) {
    return {
      score: entry.score,
      explanation: `Geschätzter Strombedarf für „${formatCategory(category)}": ${entry.label} (Score ${entry.score}/100).`,
    };
  }
  return {
    score: 40,
    explanation: `Kategorie „${formatCategory(category)}" hat unbekanntes Stromprofil (Score 40/100).`,
  };
}

// --- Solarpotenzial (Solar Score) ---

function calculateSolarScore(
  solarData?: ScoringInput['solarData']
): { score: number; explanation: string } {
  if (!solarData) {
    return {
      score: 50,
      explanation: 'Keine Solar-Bewertungsdaten vorhanden; neutraler Score (50/100).',
    };
  }

  const quality = (solarData.solar_quality ?? '').toUpperCase();
  const panels = solarData.max_array_panels_count ?? 0;
  const area = solarData.max_array_area_m2 ?? 0;
  const annualKwh = solarData.annual_energy_kwh ?? 0;

  let base = 50;
  const reasons: string[] = [];

  if (quality === 'HIGH') {
    if (panels > 200 && area > 800) {
      base = 92;
      reasons.push(`HOHE Solarqualität mit ${panels} Panelen und ${area.toFixed(0)} m\u00B2 Dachfläche — ausgezeichnetes Potenzial`);
    } else {
      base = 75;
      reasons.push(`HOHE Solarqualität — starkes Potenzial`);
      if (panels > 0) reasons.push(`${panels} Panele möglich`);
      if (area > 0) reasons.push(`${area.toFixed(0)} m\u00B2 nutzbare Fläche`);
    }
  } else if (quality === 'MEDIUM') {
    base = 58;
    reasons.push('MITTLERE Solarqualität — akzeptables Potenzial');
    if (panels > 0) reasons.push(`${panels} Panele möglich`);
  } else if (quality === 'LOW') {
    base = 28;
    reasons.push('NIEDRIGE Solarqualität — begrenztes Potenzial durch Verschattung oder Ausrichtung');
  } else {
    reasons.push('Unbekannte Solarqualitätsbewertung');
  }

  // Bonus für hohen Jahresertrag
  let bonus = 0;
  if (annualKwh > 200000) {
    bonus += 10;
    reasons.push(`Hoher prognostizierter Ertrag (${(annualKwh / 1000).toFixed(0)} MWh/Jahr) +10`);
  } else if (annualKwh > 100000) {
    bonus += 5;
    reasons.push(`Guter prognostizierter Ertrag (${(annualKwh / 1000).toFixed(0)} MWh/Jahr) +5`);
  }

  // Bonus für sehr große Fläche
  if (area > 1000) {
    bonus += 5;
    reasons.push(`Sehr große Dachfläche (${area.toFixed(0)} m\u00B2) +5`);
  }

  const score = Math.min(100, base + bonus);

  return {
    score,
    explanation: `Solar-Bewertung: ${reasons.join('; ')} (Score ${score}/100).`,
  };
}

// --- Vertriebsbereitschaft (Outreach Score) ---

function calculateOutreachScore(
  input: Pick<ScoringInput, 'hasWebsite' | 'hasPhone' | 'hasEmail' | 'enrichmentData'>
): { score: number; explanation: string } {
  let score = 0;
  const parts: string[] = [];

  if (input.hasWebsite) {
    score += 25;
    parts.push('Website vorhanden (+25)');
  }
  if (input.hasEmail) {
    score += 25;
    parts.push('E-Mail vorhanden (+25)');
  }
  if (input.hasPhone) {
    score += 20;
    parts.push('Telefon vorhanden (+20)');
  }

  if (input.enrichmentData) {
    const keywordCount = input.enrichmentData.detected_keywords.length;
    const keywordBonus = Math.min(30, keywordCount * 3);
    if (keywordBonus > 0) {
      score += keywordBonus;
      parts.push(`${keywordCount} Anreicherungs-Schlüsselwort(e) (+${keywordBonus})`);
    }
  }

  score = Math.min(100, score);

  const explanation =
    parts.length > 0
      ? `Vertriebsbereitschaft: ${parts.join(', ')} (Score ${score}/100).`
      : 'Keine Kontaktdaten oder Anreicherungsdaten vorhanden (Score 0/100).';

  return { score, explanation };
}

// --- Haupt-Scoring-Funktion ---

export function calculateScore(
  input: ScoringInput,
  weights: ScoringWeights = DEFAULT_WEIGHTS
): ScoringBreakdown {
  const business = calculateBusinessScore(input.category);
  const electricity = calculateElectricityScore(input.category);
  const solar = calculateSolarScore(input.solarData);
  const outreach = calculateOutreachScore(input);

  const total = Math.round(
    business.score * weights.business +
    electricity.score * weights.electricity +
    solar.score * weights.solar +
    outreach.score * weights.outreach
  );

  return {
    business_score: business.score,
    electricity_score: electricity.score,
    solar_score: solar.score,
    outreach_score: outreach.score,
    total_score: Math.min(100, total),
    explanations: {
      business: business.explanation,
      electricity: electricity.explanation,
      solar: solar.explanation,
      outreach: outreach.explanation,
    },
  };
}

// --- GreenScout Vertriebsanweisung Generator ---
// Basiert auf directives/vertrieb.md — GreenScout e.V. Dachflächenpacht-Modell

export function generateOutreachNotes(
  lead: { company_name: string; category: string; city: string },
  scoring: ScoringBreakdown,
  solarData?: {
    annual_energy_kwh?: number | null;
    max_array_area_m2?: number | null;
    max_array_panels_count?: number | null;
  } | null
): string {
  const cat = lead.category;
  const name = lead.company_name;
  const city = lead.city;
  const area = solarData?.max_array_area_m2 ?? null;
  const kwh = solarData?.annual_energy_kwh ?? null;

  // --- Priorität bestimmen ---
  let prioritaet: string;
  let prioritaetBegruendung: string;
  if (scoring.total_score >= 75) {
    prioritaet = 'HOCH INTERESSANT';
    prioritaetBegruendung = `Kombination aus ${formatCategory(cat)}-Betrieb, hohem Stromverbrauchsprofil und relevantem Dachpotenzial. Direkter Kontaktversuch empfohlen.`;
  } else if (scoring.total_score >= 55) {
    prioritaet = 'BEDINGT INTERESSANT';
    prioritaetBegruendung = `Grundvoraussetzungen teilweise erfüllt. Lohnt Kontaktversuch, aber Qualifizierung im Gespräch notwendig.`;
  } else {
    prioritaet = 'EHER UNPASSEND';
    prioritaetBegruendung = `Profil entspricht nicht dem GreenScout-Idealziel. Nur bei fehlendem Pipeline-Druck kontaktieren.`;
  }

  // --- Sektion 1: Kurzfazit ---
  const s1 = `## 1. Kurzfazit\n► ${prioritaet}\n${prioritaetBegruendung}`;

  // --- Sektion 2: Research-Zusammenfassung ---
  const fakten: string[] = [
    `Branche: ${formatCategory(cat)} in ${city}`,
    scoring.business_score >= 70
      ? `Kategorie mit typisch hohem Stromverbrauch und geeignetem Gebäudetyp`
      : `Kategorie mit mittlerem bis geringem Solarpotenzial`,
  ];
  if (area && area >= 500) fakten.push(`Dachfläche nach erster Einschätzung in relevanter Größenordnung (ca. ${area.toFixed(0)} m²)`);
  if (kwh && kwh > 0) fakten.push(`Prognostizierter Jahresertrag ca. ${(kwh / 1000).toFixed(0)} MWh`);

  const annahmen: string[] = [];
  const highConsumptionCats = ['cold_storage', 'manufacturing', 'metalworking', 'food_production'];
  const mediumConsumptionCats = ['supermarket', 'shopping_center', 'logistics', 'warehouse'];
  if (highConsumptionCats.includes(cat)) {
    annahmen.push(`Wahrscheinlich hoher Grundlaststrom durch ${cat === 'cold_storage' ? 'Kühlung' : 'Produktionsmaschinen'} — spricht für wirtschaftliche Attraktivität des Modells`);
  } else if (mediumConsumptionCats.includes(cat)) {
    annahmen.push(`Mittlerer bis konstanter Stromverbrauch — wirtschaftlicher Nutzen des Modells plausibel`);
  }
  if (!area || area < 500) {
    annahmen.push(`Dachfläche noch nicht geprüft — Größenordnung vor Kontakt wenn möglich via Google Maps einschätzen`);
  }
  annahmen.push(`Eigentümerstatus unklar — im Gespräch früh klären (gemietete Objekte scheiden aus)`);

  const s2 = `## 2. Research-Zusammenfassung\n**Belegte Fakten:**\n${fakten.map(f => `- ${f}`).join('\n')}\n\n**Plausible Annahmen:**\n${annahmen.map(a => `- ${a}`).join('\n')}`;

  // --- Sektion 3: Relevanz für GreenScout ---
  const dachText = area
    ? area >= 1000 ? `Sehr große Dachfläche (${area.toFixed(0)} m²) — ausgezeichnet für das Pachtmodell`
      : area >= 500 ? `Dachfläche in relevanter Größenordnung (${area.toFixed(0)} m²) — geeignet`
      : `Dachfläche nach erster Einschätzung eher klein (${area.toFixed(0)} m²) — Mindestgröße ~500 m² prüfen`
    : `Dachfläche noch nicht bewertet — Prüfung notwendig`;
  const stromText = scoring.electricity_score >= 80
    ? `Hoher Strombedarf — wirtschaftlicher Nutzen von Direktverbrauch und Pacht sehr gut darstellbar`
    : scoring.electricity_score >= 60
    ? `Mittlerer Strombedarf — Pachtmodell erklärbar, Wirtschaftlichkeit abhängig von konkreten Tarifen`
    : `Geringer Strombedarf — Pachtmodell weniger attraktiv, reine Pachteinnahmen in Vordergrund stellen`;

  const s3 = `## 3. Relevanz für GreenScout e.V.\n- **Dachflächenpotenzial:** ${dachText}\n- **Strompotenzial:** ${stromText}\n- **Anschlussfähigkeit:** ${scoring.business_score >= 70 ? 'Gut — Branche passt zum GreenScout-Modell' : 'Eingeschränkt — Branche eher schwächer'}\n- **Gesprächschance:** ${scoring.outreach_score >= 50 ? 'Kontaktdaten vorhanden — direkter Einstieg möglich' : 'Begrenzte Kontaktdaten — Recherche empfohlen'}`;

  // --- Sektion 4: Zielperson ---
  const zielpersonMap: Record<string, string> = {
    cold_storage: 'Geschäftsführer oder technischer Leiter (Kühlanlagen = hohe Betriebskosten, die er kennt)',
    manufacturing: 'Werksleiter oder Geschäftsführer (Energiekosten direkt im Blickfeld)',
    metalworking: 'Werksleiter oder Inhaber (Mittelstand — oft direkt erreichbar)',
    food_production: 'Betriebsleiter oder Geschäftsführer',
    supermarket: 'Marktleiter oder Regionalverantwortlicher (Energiekosten zentrales Thema)',
    logistics: 'Facility Manager oder Geschäftsführer',
    warehouse: 'Betriebsleiter oder Eigentümervertreter',
    hotel: 'Hoteldirektor oder Eigentümer (bei Privathotels)',
    shopping_center: 'Asset Manager oder Centermanager',
    car_dealership: 'Inhaber oder Geschäftsführer (oft Familienunternehmen)',
    hardware_store: 'Marktleiter oder Inhaber',
    furniture_store: 'Einrichtungshaus-Leiter oder Eigentümer',
  };
  const zielperson = zielpersonMap[cat] ?? 'Geschäftsführer oder Inhaber (allgemeine Erstansprache)';
  const s4 = `## 4. Wahrscheinlich beste Zielperson\n- **Funktion:** ${zielperson}\n- **Hinweis:** Im Erstkontakt Eigentümerstatus des Gebäudes klären — gemietete Objekte scheiden aus dem Modell aus`;

  // --- Sektion 5: Ansprachelogik ---
  const tonality = scoring.business_score >= 80
    ? 'Direkt und wirtschaftlich — dieser Betriebstyp denkt in Zahlen. Pachteinnahmen und Stromkostenvorteil in den Vordergrund.'
    : scoring.business_score >= 60
    ? 'Sachlich und konkret — nicht zu technisch, Fokus auf wirtschaftlichen Mehrwert ohne Eigeninvestition.'
    : 'Zurückhaltend und informierend — erst Modell erklären, dann Interesse abfragen.';

  const s5 = `## 5. Empfohlene Ansprachelogik\n- **Einstieg:** Mit der Fläche beginnen, nicht mit Solar. „Wir schauen uns gewerbliche Immobilien an, deren Dachfläche wirtschaftlich mehr leisten könnte."\n- **Fokus:** Pachteinnahmen + möglicher Stromkostenvorteil + keine Eigeninvestition\n- **Tonalität:** ${tonality}\n- **Im Erstkontakt vermeiden:** Technische Details zur Anlage, Renditeversprechen, Investitionsvolumina`;

  // --- Sektion 6: Nutzenargumente ---
  const nutzenArgs: string[] = [];
  if (area && area >= 500) nutzenArgs.push(`Ihre Dachfläche von ca. ${area.toFixed(0)} m² könnte durch Verpachtung laufende Einnahmen generieren — ohne eigene Investition`);
  else nutzenArgs.push(`Ungenutzte Dachfläche kann durch Verpachtung laufende Einnahmen generieren — ohne eigene Investition`);

  if (highConsumptionCats.includes(cat)) {
    nutzenArgs.push(`Als ${formatCategory(cat)}-Betrieb haben Sie dauerhaft hohen Strombedarf — Teil des erzeugten Stroms kann direkt genutzt werden`);
    nutzenArgs.push(`Langfristige Preisstabilität beim Strom — unabhängig von Marktschwankungen`);
  } else {
    nutzenArgs.push(`Möglicher günstigerer Strombezug als Teil des Pachtmodells`);
  }
  nutzenArgs.push(`Erst prüfen, dann entscheiden — kein Risiko im Erstgespräch`);
  nutzenArgs.push(`Investor übernimmt Finanzierung, Installation und Betrieb der Anlage vollständig`);

  const s6 = `## 6. Individuelle Nutzenargumente\n${nutzenArgs.map((a, i) => `${i + 1}. ${a}`).join('\n')}`;

  // --- Sektion 7: Einwände ---
  const einwaende = [
    'Kein Interesse / kein Bedarf',
    'Wir haben keine Zeit für sowas',
    'Wir mieten das Gebäude nur',
    cat === 'cold_storage' || cat === 'manufacturing'
      ? 'Wir haben schon eine PV-Anlage'
      : 'Das ist uns zu aufwändig',
    'Wir kennen das Modell nicht und wollen nichts unterschreiben',
  ];
  const s7 = `## 7. Wahrscheinliche Einwände\n${einwaende.map((e, i) => `${i + 1}. ${e}`).join('\n')}`;

  // --- Sektion 8: Einwandbehandlung ---
  const behandlung = [
    `„Kein Interesse": „Das verstehe ich. Darf ich kurz fragen — geht es eher darum, dass Sie keine Zeit haben, oder ist das Modell noch nicht klar? Wir reden nicht von einem Kauf, sondern von einer Prüfung."`,
    `„Keine Zeit": „Ich brauche nur 15 Minuten — kein Angebot, kein Abschluss. Nur schauen, ob es bei Ihnen überhaupt Sinn macht."`,
    `„Wir mieten nur": „Dann ist das für uns tatsächlich kein passendes Modell — danke für die Auskunft. Darf ich fragen, ob Sie den Eigentümer kennen?"`,
    `„Wir haben schon PV": „Sehr gut. Dann wissen Sie, wie das funktioniert. Wir schauen trotzdem kurz, ob es Flächen gibt, die noch nicht genutzt werden — oder ob wir Ihnen ein besseres Modell zeigen können."`,
    `„Kein Interesse am Unterschreiben": „Im Erstgespräch gibt es nichts zu unterschreiben. Wir schauen nur gemeinsam, ob es technisch und wirtschaftlich passt. Erst dann entscheiden Sie."`,
  ];
  const s8 = `## 8. Einwandbehandlung\n${behandlung.map(b => `- ${b}`).join('\n')}`;

  // --- Sektion 9: Telefonskript ---
  const areaHint = area && area >= 500
    ? ` Nach unserer ersten Einschätzung sprechen wir bei Ihnen über eine Dachfläche in einer wirtschaftlich relevanten Größenordnung.`
    : '';
  const telefon = `„Guten Tag, mein Name ist [Name] von GreenScout e.V. — darf ich Sie kurz stören?\n\nWir schauen uns aktuell gewerbliche Immobilien in ${city} an, deren Dachflächen wirtschaftlich stärker genutzt werden könnten.${areaHint}\n\nBei Ihnen als ${formatCategory(cat)}-Betrieb könnte das interessant sein — nicht weil wir etwas verkaufen wollen, sondern weil wir prüfen, ob ein Pachtmodell für Sie wirtschaftlich Sinn ergibt: Einnahmen aus der Dachfläche, möglicher Stromkostenvorteil, keine eigene Investition.\n\nHätten Sie in den nächsten Tagen 15 Minuten für ein erstes kurzes Gespräch?"`;
  const s9 = `## 9. Telefon-Einstieg\n\`\`\`\n${telefon}\n\`\`\``;

  // --- Sektion 10: Erste E-Mail ---
  const email = `Betreff: Ihre Dachfläche in ${city} — kurze Frage

Sehr geehrte Damen und Herren,

wir von GreenScout e.V. beschäftigen uns mit gewerblichen Immobilien, deren Dachflächen wirtschaftlich mehr leisten könnten — durch ein Pachtmodell, bei dem ein Investor die gesamte Anlage finanziert und Sie als Flächenbesitzer mögliche Pachteinnahmen erzielen.

Ihr Standort in ${city} ist uns aufgefallen. Als ${formatCategory(cat)}-Betrieb könnte das Modell für Sie interessant sein — ohne eigene Investition, nur auf Basis einer gemeinsamen Prüfung.

Darf ich kurz fragen, ob Sie der richtige Ansprechpartner dafür sind, und ob wir 15 Minuten finden?

Mit freundlichen Grüßen
[Name]
GreenScout e.V.`;
  const s10 = `## 10. Erste Anbahnungs-E-Mail\n\`\`\`\n${email}\n\`\`\``;

  // --- Sektion 11: Nächster Schritt ---
  let naechsterSchritt: string;
  if (scoring.total_score >= 75) {
    naechsterSchritt = scoring.outreach_score >= 50
      ? '► **E-Mail + Anruf** — E-Mail vorab senden, 2 Tage später anrufen. Hohe Priorität.'
      : '► **Anrufen** — Kontaktdaten recherchieren und direkt telefonieren. Hohe Priorität.';
  } else if (scoring.total_score >= 55) {
    naechsterSchritt = scoring.outreach_score >= 50
      ? '► **E-Mail senden** — niedrigschwelliger Einstieg, Reaktion abwarten.'
      : '► **Kontaktdaten recherchieren**, dann telefonieren.';
  } else {
    naechsterSchritt = '► **Vorerst nicht weiterverfolgen** — Profil passt nicht gut genug. Erneut prüfen wenn Pipeline leer.';
  }
  const s11 = `## 11. Nächster sinnvoller Schritt\n${naechsterSchritt}`;

  // --- Sektion 12: Vertriebsbewertung ---
  const flaecheScore = area
    ? area >= 1000 ? 9 : area >= 500 ? 7 : 4
    : Math.round(scoring.business_score / 12);
  const stromScore = Math.round(scoring.electricity_score / 11);
  const gespraechScore = Math.round((scoring.outreach_score * 0.6 + scoring.business_score * 0.4) / 11);
  const gesamtScore = Math.round((flaecheScore + stromScore + gespraechScore) / 3);

  const s12 = `## 12. Vertriebsbewertung (intern)\n| Kriterium | Bewertung |\n|---|---|\n| Flächenpotenzial | ${flaecheScore}/10 |\n| Strompotenzial | ${stromScore}/10 |\n| Gesprächschance | ${gespraechScore}/10 |\n| **Gesamtpotenzial** | **${gesamtScore}/10** |`;

  return [
    `# Vertriebsanweisung – ${name}`,
    s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11, s12
  ].join('\n\n---\n\n');
}
