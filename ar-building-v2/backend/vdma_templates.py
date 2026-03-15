# DIN 276 Kostengruppen (KG 400) und VDMA 24186 Wartungs-Checklisten.
# Statische Referenzdaten — werden beim Erstellen von Wartungsplänen
# als Vorlage in die Datenbank kopiert und können dort angepasst werden.

DIN276_KOSTENGRUPPEN = {
    "410": {"label": "Abwasser-, Wasser-, Gasanlagen", "gewerk": "Sanitärtechnik"},
    "420": {"label": "Wärmeversorgungsanlagen", "gewerk": "Heizungstechnik"},
    "430": {"label": "Lufttechnische Anlagen", "gewerk": "Raumlufttechnik"},
    "440": {"label": "Starkstromanlagen", "gewerk": "Elektrotechnik"},
    "450": {"label": "Fernmelde-/Informationstechnik", "gewerk": "Informationstechnik"},
    "460": {"label": "Förderanlagen", "gewerk": "Fördertechnik"},
    "470": {"label": "Nutzungsspezifische Anlagen", "gewerk": "Verfahrenstechnik"},
    "480": {"label": "Gebäudeautomation", "gewerk": "MSR-/Gebäudeautomation"},
    "490": {"label": "Sonstige Maßnahmen für techn. Anlagen", "gewerk": "Sonstige"},
}

VDMA_CHECKLISTS = {
    "410": [
        {"id": "410-01", "text": "Absperrventile Funktion prüfen", "group": "Sanitärtechnik"},
        {"id": "410-02", "text": "Trinkwasserleitungen Sichtprüfung", "group": "Sanitärtechnik"},
        {"id": "410-03", "text": "Wasserfilter reinigen/wechseln", "group": "Sanitärtechnik"},
        {"id": "410-04", "text": "Legionellenprüfung / Probenahme", "group": "Sanitärtechnik"},
        {"id": "410-05", "text": "Abwasserleitungen Dichtheit prüfen", "group": "Sanitärtechnik"},
        {"id": "410-06", "text": "Druckminderer prüfen und einstellen", "group": "Sanitärtechnik"},
        {"id": "410-07", "text": "Rückflussverhinderer prüfen", "group": "Sanitärtechnik"},
        {"id": "410-08", "text": "Warmwasserbereiter Entkalkung", "group": "Sanitärtechnik"},
    ],
    "420": [
        {"id": "420-01", "text": "Brenner Sichtprüfung und Reinigung", "group": "Heizungstechnik"},
        {"id": "420-02", "text": "Abgasmessung durchführen", "group": "Heizungstechnik"},
        {"id": "420-03", "text": "Sicherheitsventile prüfen", "group": "Heizungstechnik"},
        {"id": "420-04", "text": "Ausdehnungsgefäß Vordruck prüfen", "group": "Heizungstechnik"},
        {"id": "420-05", "text": "Umwälzpumpen Funktion prüfen", "group": "Heizungstechnik"},
        {"id": "420-06", "text": "Heizflächen reinigen", "group": "Heizungstechnik"},
        {"id": "420-07", "text": "Regelung und Steuerung Funktionstest", "group": "Heizungstechnik"},
        {"id": "420-08", "text": "Schornsteinfeger-Messung dokumentieren", "group": "Heizungstechnik"},
    ],
    "430": [
        {"id": "430-01", "text": "Luftfilter prüfen und wechseln", "group": "Raumlufttechnik"},
        {"id": "430-02", "text": "Keilriemen / Antriebsriemen prüfen", "group": "Raumlufttechnik"},
        {"id": "430-03", "text": "Ventilatoren reinigen", "group": "Raumlufttechnik"},
        {"id": "430-04", "text": "Wärmetauscher reinigen", "group": "Raumlufttechnik"},
        {"id": "430-05", "text": "Kondensatablauf prüfen", "group": "Raumlufttechnik"},
        {"id": "430-06", "text": "Klappen und Stellantriebe prüfen", "group": "Raumlufttechnik"},
        {"id": "430-07", "text": "Luftvolumenstrom messen", "group": "Raumlufttechnik"},
        {"id": "430-08", "text": "Hygieneinspection nach VDI 6022", "group": "Raumlufttechnik"},
    ],
    "440": [
        {"id": "440-01", "text": "Sichtprüfung Verteilungen und Schaltanlagen", "group": "Elektrotechnik"},
        {"id": "440-02", "text": "Schutzleiter Durchgangsprüfung", "group": "Elektrotechnik"},
        {"id": "440-03", "text": "RCD/FI-Schutzschalter Auslösetest", "group": "Elektrotechnik"},
        {"id": "440-04", "text": "USV-Anlage / Batterietest", "group": "Elektrotechnik"},
        {"id": "440-05", "text": "Beleuchtungsanlage prüfen", "group": "Elektrotechnik"},
        {"id": "440-06", "text": "Blitzschutzanlage prüfen", "group": "Elektrotechnik"},
        {"id": "440-07", "text": "Isolationswiderstand messen", "group": "Elektrotechnik"},
    ],
    "450": [
        {"id": "450-01", "text": "Brandmeldeanlage Funktionstest", "group": "Informationstechnik"},
        {"id": "450-02", "text": "Einbruchmeldeanlage prüfen", "group": "Informationstechnik"},
        {"id": "450-03", "text": "Sprechanlage / Gegensprechanlage testen", "group": "Informationstechnik"},
        {"id": "450-04", "text": "Netzwerk-Infrastruktur Sichtprüfung", "group": "Informationstechnik"},
        {"id": "450-05", "text": "Notrufsysteme testen", "group": "Informationstechnik"},
    ],
    "460": [
        {"id": "460-01", "text": "Aufzugsanlage Sicherheitsprüfung", "group": "Fördertechnik"},
        {"id": "460-02", "text": "Türantriebe und Verriegelungen prüfen", "group": "Fördertechnik"},
        {"id": "460-03", "text": "Notrufeinrichtung testen", "group": "Fördertechnik"},
        {"id": "460-04", "text": "Beleuchtung Fahrkorb prüfen", "group": "Fördertechnik"},
        {"id": "460-05", "text": "Führungsschienen schmieren", "group": "Fördertechnik"},
    ],
    "470": [
        {"id": "470-01", "text": "Bühnentechnik Sichtprüfung", "group": "Verfahrenstechnik"},
        {"id": "470-02", "text": "Spezialanlagen Funktionstest", "group": "Verfahrenstechnik"},
        {"id": "470-03", "text": "Sicherheitseinrichtungen prüfen", "group": "Verfahrenstechnik"},
    ],
    "480": [
        {"id": "480-01", "text": "GLT-Sensoren Kalibrierung prüfen", "group": "MSR-/Gebäudeautomation"},
        {"id": "480-02", "text": "Stellantriebe / Aktoren Funktion prüfen", "group": "MSR-/Gebäudeautomation"},
        {"id": "480-03", "text": "Datenpunkte und Trendaufzeichnungen kontrollieren", "group": "MSR-/Gebäudeautomation"},
        {"id": "480-04", "text": "Alarme und Grenzwerte prüfen", "group": "MSR-/Gebäudeautomation"},
        {"id": "480-05", "text": "Datensicherung erstellen", "group": "MSR-/Gebäudeautomation"},
    ],
    "490": [
        {"id": "490-01", "text": "Allgemeine Sichtprüfung", "group": "Sonstige"},
        {"id": "490-02", "text": "Funktionstest durchführen", "group": "Sonstige"},
        {"id": "490-03", "text": "Dokumentation prüfen und aktualisieren", "group": "Sonstige"},
    ],
}


def get_template_for_kg(kg: str) -> dict | None:
    """Gibt die vollständige VDMA-Vorlage für eine Kostengruppe zurück."""
    info = DIN276_KOSTENGRUPPEN.get(kg)
    if not info:
        return None
    return {
        "kg": kg,
        "label": info["label"],
        "gewerk": info["gewerk"],
        "items": VDMA_CHECKLISTS.get(kg, []),
    }


def get_all_templates() -> list[dict]:
    """Gibt alle VDMA-Vorlagen zurück."""
    return [get_template_for_kg(kg) for kg in sorted(DIN276_KOSTENGRUPPEN.keys())]
