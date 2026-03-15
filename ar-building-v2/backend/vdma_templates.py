# DIN 276 Kostengruppen (KG 400) und VDMA 24186 Wartungsanweisungen.
# Statische Referenzdaten mit Anlagenvarianten und detaillierten Wartungsprotokollen.
# Pro Kostengruppe gibt es mehrere Anlagenvarianten mit spezifischen Wartungsaufgaben.

VDMA_ANLAGEN = {
    # ──────────────────────────────────────────────────────────────
    # KG 410 – Abwasser-, Wasser-, Gasanlagen (Sanitärtechnik)
    # ──────────────────────────────────────────────────────────────
    "410": {
        "label": "Abwasser-, Wasser-, Gasanlagen",
        "gewerk": "Sanitärtechnik",
        "varianten": {
            "trinkwasser_kalt": {
                "label": "Trinkwasser-Kaltwasseranlage",
                "wartung": [
                    {"id": "410-TK-01", "text": "Sichtprüfung aller Rohrleitungen auf Korrosion und Leckagen", "interval_months": 12, "priority": "hoch"},
                    {"id": "410-TK-02", "text": "Absperrventile auf Gängigkeit und Dichtheit prüfen", "interval_months": 12, "priority": "hoch"},
                    {"id": "410-TK-03", "text": "Druckminderer Einstellung prüfen und ggf. nachstellen", "interval_months": 12, "priority": "mittel"},
                    {"id": "410-TK-04", "text": "Rückflussverhinderer Funktionsprüfung nach DIN EN 1717", "interval_months": 12, "priority": "hoch"},
                    {"id": "410-TK-05", "text": "Wasserfilter kontrollieren, reinigen oder wechseln", "interval_months": 6, "priority": "hoch"},
                    {"id": "410-TK-06", "text": "Wasserzähler Ablesewerte dokumentieren", "interval_months": 12, "priority": "niedrig"},
                    {"id": "410-TK-07", "text": "Probenahme Trinkwasser nach TrinkwV §14 (mikrobiologisch)", "interval_months": 12, "priority": "hoch"},
                    {"id": "410-TK-08", "text": "Rohrisolierung auf Beschädigung und Schwitzwasserbildung prüfen", "interval_months": 12, "priority": "mittel"},
                    {"id": "410-TK-09", "text": "Stagnationsleitungen spülen (selten genutzte Entnahmestellen)", "interval_months": 1, "priority": "hoch"},
                ],
            },
            "trinkwasser_warm": {
                "label": "Trinkwasser-Warmwasseranlage",
                "wartung": [
                    {"id": "410-TW-01", "text": "Legionellenprüfung nach DVGW W 551 (Probenahme)", "interval_months": 12, "priority": "hoch"},
                    {"id": "410-TW-02", "text": "Speichertemperatur prüfen (min. 60°C am Austritt)", "interval_months": 3, "priority": "hoch"},
                    {"id": "410-TW-03", "text": "Zirkulationspumpe Funktion und Förderstrom prüfen", "interval_months": 12, "priority": "mittel"},
                    {"id": "410-TW-04", "text": "Zirkulationstemperatur prüfen (min. 55°C Rücklauf)", "interval_months": 3, "priority": "hoch"},
                    {"id": "410-TW-05", "text": "Trinkwassererwärmer Anode prüfen (Opferanode/Fremdstromanode)", "interval_months": 24, "priority": "mittel"},
                    {"id": "410-TW-06", "text": "Sicherheitsventil am Speicher auf Funktion prüfen", "interval_months": 6, "priority": "hoch"},
                    {"id": "410-TW-07", "text": "Speicher und Wärmetauscher auf Verkalkung prüfen, ggf. entkalken", "interval_months": 24, "priority": "mittel"},
                    {"id": "410-TW-08", "text": "Thermische Desinfektion durchführen (>70°C, 3 Min.)", "interval_months": 12, "priority": "hoch"},
                    {"id": "410-TW-09", "text": "Thermometer und Temperaturregelung kalibrieren", "interval_months": 12, "priority": "mittel"},
                ],
            },
            "abwasseranlage": {
                "label": "Abwasseranlage / Entwässerung",
                "wartung": [
                    {"id": "410-AW-01", "text": "Sichtprüfung Grundleitungen und Revisionsöffnungen", "interval_months": 12, "priority": "mittel"},
                    {"id": "410-AW-02", "text": "Bodenabläufe und Rinnen reinigen, Geruchsverschluss prüfen", "interval_months": 6, "priority": "mittel"},
                    {"id": "410-AW-03", "text": "Hebeanlagen Funktion und Rückstauebene prüfen", "interval_months": 6, "priority": "hoch"},
                    {"id": "410-AW-04", "text": "Rückstauverschlüsse Funktion prüfen und reinigen", "interval_months": 6, "priority": "hoch"},
                    {"id": "410-AW-05", "text": "Fettabscheider entleeren und reinigen", "interval_months": 3, "priority": "hoch"},
                    {"id": "410-AW-06", "text": "Dichtheitsprüfung Abwasserleitungen nach DIN EN 1610", "interval_months": 60, "priority": "hoch"},
                    {"id": "410-AW-07", "text": "Dachentwässerung (Abläufe, Rinnen, Fallrohre) reinigen", "interval_months": 6, "priority": "mittel"},
                ],
            },
            "gasanlage": {
                "label": "Gasanlage (Hausinstallation)",
                "wartung": [
                    {"id": "410-GA-01", "text": "Gasinstallation Sichtprüfung auf Korrosion und Beschädigung", "interval_months": 12, "priority": "hoch"},
                    {"id": "410-GA-02", "text": "Dichtheitsprüfung Gasleitungen nach DVGW G 600 (TRGI)", "interval_months": 12, "priority": "hoch"},
                    {"id": "410-GA-03", "text": "Gaszähler und Druckregler Funktion prüfen", "interval_months": 12, "priority": "hoch"},
                    {"id": "410-GA-04", "text": "Thermisch auslösende Absperreinrichtung (TAE) prüfen", "interval_months": 12, "priority": "hoch"},
                    {"id": "410-GA-05", "text": "Belüftung der Aufstellräume prüfen", "interval_months": 12, "priority": "mittel"},
                    {"id": "410-GA-06", "text": "Gasströmungswächter Funktion prüfen", "interval_months": 12, "priority": "hoch"},
                ],
            },
        },
    },
    # ──────────────────────────────────────────────────────────────
    # KG 420 – Wärmeversorgungsanlagen (Heizungstechnik)
    # ──────────────────────────────────────────────────────────────
    "420": {
        "label": "Wärmeversorgungsanlagen",
        "gewerk": "Heizungstechnik",
        "varianten": {
            "gas_brennwert": {
                "label": "Gas-Brennwertkessel",
                "wartung": [
                    {"id": "420-GB-01", "text": "Brenner Sichtprüfung, Elektroden reinigen", "interval_months": 12, "priority": "hoch"},
                    {"id": "420-GB-02", "text": "Brennraum und Heizflächen reinigen", "interval_months": 12, "priority": "hoch"},
                    {"id": "420-GB-03", "text": "Abgasmessung nach 1. BImSchV (O₂, CO, Abgastemperatur)", "interval_months": 12, "priority": "hoch"},
                    {"id": "420-GB-04", "text": "Kondensatablauf und Siphon prüfen und reinigen", "interval_months": 12, "priority": "mittel"},
                    {"id": "420-GB-05", "text": "Sicherheitsventil Funktion prüfen (anlüften)", "interval_months": 12, "priority": "hoch"},
                    {"id": "420-GB-06", "text": "Ausdehnungsgefäß Vordruck prüfen und ggf. nachfüllen", "interval_months": 12, "priority": "hoch"},
                    {"id": "420-GB-07", "text": "Gasarmatur und Gasdruckregler prüfen", "interval_months": 12, "priority": "hoch"},
                    {"id": "420-GB-08", "text": "Regelung und Steuerung Funktionstest (Heizkurve, Timer)", "interval_months": 12, "priority": "mittel"},
                    {"id": "420-GB-09", "text": "Umwälzpumpen Funktion, Fördermenge und Drehzahl prüfen", "interval_months": 12, "priority": "mittel"},
                    {"id": "420-GB-10", "text": "Anlagendruck und Wasserqualität prüfen (pH, Leitfähigkeit)", "interval_months": 12, "priority": "mittel"},
                    {"id": "420-GB-11", "text": "Schornsteinfeger-Messung dokumentieren (Bescheinigung)", "interval_months": 12, "priority": "hoch"},
                ],
            },
            "oel_brennwert": {
                "label": "Öl-Brennwertkessel",
                "wartung": [
                    {"id": "420-OB-01", "text": "Ölbrenner reinigen, Düse und Filter wechseln", "interval_months": 12, "priority": "hoch"},
                    {"id": "420-OB-02", "text": "Brennraum und Heizflächen reinigen, Rußzahl messen", "interval_months": 12, "priority": "hoch"},
                    {"id": "420-OB-03", "text": "Abgasmessung nach 1. BImSchV durchführen", "interval_months": 12, "priority": "hoch"},
                    {"id": "420-OB-04", "text": "Kondensatablauf prüfen und neutralisieren", "interval_months": 12, "priority": "mittel"},
                    {"id": "420-OB-05", "text": "Öltank und Leitungen auf Dichtheit prüfen", "interval_months": 12, "priority": "hoch"},
                    {"id": "420-OB-06", "text": "Ölfilter reinigen/wechseln, Ölvorwärmer prüfen", "interval_months": 12, "priority": "hoch"},
                    {"id": "420-OB-07", "text": "Sicherheitsventile und Ausdehnungsgefäß prüfen", "interval_months": 12, "priority": "hoch"},
                    {"id": "420-OB-08", "text": "Regelung, Steuerung und Außenfühler Funktionstest", "interval_months": 12, "priority": "mittel"},
                    {"id": "420-OB-09", "text": "Schornsteinfeger-Messung dokumentieren", "interval_months": 12, "priority": "hoch"},
                ],
            },
            "waermepumpe_luft": {
                "label": "Wärmepumpe (Luft/Wasser)",
                "wartung": [
                    {"id": "420-WL-01", "text": "Außeneinheit Sichtprüfung: Verschmutzung, Fremdkörper entfernen", "interval_months": 6, "priority": "hoch"},
                    {"id": "420-WL-02", "text": "Verdampfer-Lamellen reinigen (ggf. Hochdruckreiniger)", "interval_months": 12, "priority": "hoch"},
                    {"id": "420-WL-03", "text": "Kältemittel-Kreislauf: Drücke und Temperaturen prüfen", "interval_months": 12, "priority": "hoch"},
                    {"id": "420-WL-04", "text": "Kältemittelleckageprüfung nach F-Gase-Verordnung", "interval_months": 12, "priority": "hoch"},
                    {"id": "420-WL-05", "text": "Ventilator Funktion, Lager und Vibrationen prüfen", "interval_months": 12, "priority": "mittel"},
                    {"id": "420-WL-06", "text": "Kondensatablauf und Abtaueinrichtung prüfen", "interval_months": 12, "priority": "mittel"},
                    {"id": "420-WL-07", "text": "Heizungspuffer und Hydraulik prüfen", "interval_months": 12, "priority": "mittel"},
                    {"id": "420-WL-08", "text": "Regelung und COP-Werte dokumentieren", "interval_months": 12, "priority": "mittel"},
                    {"id": "420-WL-09", "text": "Elektrische Anschlüsse und Sicherungen prüfen", "interval_months": 12, "priority": "mittel"},
                ],
            },
            "waermepumpe_sole": {
                "label": "Wärmepumpe (Sole/Wasser - Erdwärme)",
                "wartung": [
                    {"id": "420-WS-01", "text": "Solekreislauf: Druck und Frostschutzkonzentration prüfen", "interval_months": 12, "priority": "hoch"},
                    {"id": "420-WS-02", "text": "Kältemittel-Kreislauf: Drücke und Temperaturen prüfen", "interval_months": 12, "priority": "hoch"},
                    {"id": "420-WS-03", "text": "Kältemittelleckageprüfung nach F-Gase-Verordnung", "interval_months": 12, "priority": "hoch"},
                    {"id": "420-WS-04", "text": "Solepumpe Funktion und Fördermenge prüfen", "interval_months": 12, "priority": "mittel"},
                    {"id": "420-WS-05", "text": "Heizungspuffer und Hydraulik prüfen", "interval_months": 12, "priority": "mittel"},
                    {"id": "420-WS-06", "text": "Regelung und COP-Werte dokumentieren", "interval_months": 12, "priority": "mittel"},
                    {"id": "420-WS-07", "text": "Elektrische Anschlüsse und Sicherungen prüfen", "interval_months": 12, "priority": "mittel"},
                ],
            },
            "fernwaerme": {
                "label": "Fernwärmeübergabestation",
                "wartung": [
                    {"id": "420-FW-01", "text": "Wärmetauscher: Primär-/Sekundärtemperaturen und Leistung prüfen", "interval_months": 12, "priority": "hoch"},
                    {"id": "420-FW-02", "text": "Regelventil und Stellantrieb Funktion prüfen", "interval_months": 12, "priority": "hoch"},
                    {"id": "420-FW-03", "text": "Sicherheitsventile und Druckbegrenzer prüfen", "interval_months": 12, "priority": "hoch"},
                    {"id": "420-FW-04", "text": "Schmutzfänger reinigen (Primär- und Sekundärseite)", "interval_months": 12, "priority": "mittel"},
                    {"id": "420-FW-05", "text": "Ausdehnungsgefäß Sekundärseite Vordruck prüfen", "interval_months": 12, "priority": "mittel"},
                    {"id": "420-FW-06", "text": "Umwälzpumpen Sekundärseite prüfen", "interval_months": 12, "priority": "mittel"},
                    {"id": "420-FW-07", "text": "Wärmemengenzähler Ablesewerte dokumentieren", "interval_months": 12, "priority": "niedrig"},
                ],
            },
            "fussbodenheizung": {
                "label": "Fußbodenheizung",
                "wartung": [
                    {"id": "420-FH-01", "text": "Heizkreisverteiler Sichtprüfung und Entlüftung", "interval_months": 12, "priority": "mittel"},
                    {"id": "420-FH-02", "text": "Stellantriebe / Thermostatventile Funktion prüfen", "interval_months": 12, "priority": "mittel"},
                    {"id": "420-FH-03", "text": "Vorlauftemperatur und Spreizung prüfen", "interval_months": 12, "priority": "mittel"},
                    {"id": "420-FH-04", "text": "Durchflussmengenbegrenzer einstellen/prüfen", "interval_months": 12, "priority": "niedrig"},
                    {"id": "420-FH-05", "text": "Heizwasser Qualität prüfen (pH-Wert, Sauerstoffgehalt)", "interval_months": 24, "priority": "mittel"},
                ],
            },
        },
    },
    # ──────────────────────────────────────────────────────────────
    # KG 430 – Lufttechnische Anlagen (Raumlufttechnik)
    # ──────────────────────────────────────────────────────────────
    "430": {
        "label": "Lufttechnische Anlagen",
        "gewerk": "Raumlufttechnik",
        "varianten": {
            "zentrale_rlt": {
                "label": "Zentrale RLT-Anlage (Lüftungsgerät)",
                "wartung": [
                    {"id": "430-ZR-01", "text": "Luftfilter prüfen, ggf. wechseln (Differenzdruck beachten)", "interval_months": 3, "priority": "hoch"},
                    {"id": "430-ZR-02", "text": "Keilriemen/Antriebsriemen Spannung und Zustand prüfen", "interval_months": 6, "priority": "mittel"},
                    {"id": "430-ZR-03", "text": "Ventilatoren reinigen, Unwucht und Laufgeräusche prüfen", "interval_months": 12, "priority": "hoch"},
                    {"id": "430-ZR-04", "text": "Wärmerückgewinnung (WRG) reinigen und Effizienz prüfen", "interval_months": 12, "priority": "mittel"},
                    {"id": "430-ZR-05", "text": "Wärmetauscher (Heiz-/Kühlregister) reinigen", "interval_months": 12, "priority": "mittel"},
                    {"id": "430-ZR-06", "text": "Kondensatablauf und Kondensatwanne reinigen", "interval_months": 6, "priority": "hoch"},
                    {"id": "430-ZR-07", "text": "Klappen und Stellantriebe Funktion prüfen", "interval_months": 12, "priority": "mittel"},
                    {"id": "430-ZR-08", "text": "Luftvolumenstrom an Hauptkanälen messen und dokumentieren", "interval_months": 12, "priority": "mittel"},
                    {"id": "430-ZR-09", "text": "Hygieneinspection nach VDI 6022 (Geräteinspektion)", "interval_months": 24, "priority": "hoch"},
                    {"id": "430-ZR-10", "text": "Schalldämpfer und Brandschutzklappen Sichtprüfung", "interval_months": 12, "priority": "mittel"},
                    {"id": "430-ZR-11", "text": "Kanalnetz Dichtheitsprüfung (Stichproben)", "interval_months": 60, "priority": "niedrig"},
                ],
            },
            "split_klima": {
                "label": "Split-/Multisplit-Klimaanlage",
                "wartung": [
                    {"id": "430-SK-01", "text": "Innengerät-Filter reinigen/wechseln", "interval_months": 3, "priority": "hoch"},
                    {"id": "430-SK-02", "text": "Innengerät Wärmetauscher (Verdampfer) reinigen", "interval_months": 12, "priority": "mittel"},
                    {"id": "430-SK-03", "text": "Kondensatablauf Innengerät prüfen und reinigen", "interval_months": 6, "priority": "mittel"},
                    {"id": "430-SK-04", "text": "Außengerät reinigen, Lamellen prüfen", "interval_months": 12, "priority": "hoch"},
                    {"id": "430-SK-05", "text": "Kältemittel: Drücke prüfen, Leckageprüfung", "interval_months": 12, "priority": "hoch"},
                    {"id": "430-SK-06", "text": "Kältemittelleckageprüfung nach F-Gase-Verordnung (>3 kg)", "interval_months": 12, "priority": "hoch"},
                    {"id": "430-SK-07", "text": "Elektrische Anschlüsse und Sicherungen prüfen", "interval_months": 12, "priority": "mittel"},
                    {"id": "430-SK-08", "text": "Fernbedienung und Regelung Funktionstest", "interval_months": 12, "priority": "niedrig"},
                ],
            },
            "kaeltemaschine": {
                "label": "Kältemaschine / Kaltwassersatz",
                "wartung": [
                    {"id": "430-KM-01", "text": "Verdichter: Ölstand, Drücke (HD/ND) und Temperaturen prüfen", "interval_months": 6, "priority": "hoch"},
                    {"id": "430-KM-02", "text": "Kältemittelleckageprüfung nach F-Gase-Verordnung", "interval_months": 6, "priority": "hoch"},
                    {"id": "430-KM-03", "text": "Verflüssiger reinigen (Luft-/Wassergekühlt)", "interval_months": 6, "priority": "hoch"},
                    {"id": "430-KM-04", "text": "Verdampfer reinigen und Temperaturspreizung prüfen", "interval_months": 12, "priority": "mittel"},
                    {"id": "430-KM-05", "text": "Ölanalyse und ggf. Ölwechsel", "interval_months": 24, "priority": "mittel"},
                    {"id": "430-KM-06", "text": "Sicherheits- und Regelorgane (HD/ND-Pressostat) prüfen", "interval_months": 12, "priority": "hoch"},
                    {"id": "430-KM-07", "text": "Rückkühler/Kühlturm: Wasserqualität, Legionellen, Bioziddosierung", "interval_months": 6, "priority": "hoch"},
                    {"id": "430-KM-08", "text": "Elektrische Anlage, Schütze und Motorschutz prüfen", "interval_months": 12, "priority": "mittel"},
                    {"id": "430-KM-09", "text": "Schwingungsmessung Verdichter", "interval_months": 12, "priority": "niedrig"},
                ],
            },
            "einzelraum_lueftung": {
                "label": "Dezentrale Lüftungsanlage / Einzelraumlüftung",
                "wartung": [
                    {"id": "430-EL-01", "text": "Filter reinigen oder wechseln", "interval_months": 3, "priority": "hoch"},
                    {"id": "430-EL-02", "text": "Ventilator reinigen, Laufgeräusche prüfen", "interval_months": 12, "priority": "mittel"},
                    {"id": "430-EL-03", "text": "Wärmerückgewinnung (Keramik-/Plattenwärmetauscher) reinigen", "interval_months": 12, "priority": "mittel"},
                    {"id": "430-EL-04", "text": "Außenhaube und Insektenschutzgitter reinigen", "interval_months": 6, "priority": "mittel"},
                    {"id": "430-EL-05", "text": "Kondensat-Abführung prüfen", "interval_months": 12, "priority": "niedrig"},
                ],
            },
        },
    },
    # ──────────────────────────────────────────────────────────────
    # KG 440 – Starkstromanlagen (Elektrotechnik)
    # ──────────────────────────────────────────────────────────────
    "440": {
        "label": "Starkstromanlagen",
        "gewerk": "Elektrotechnik",
        "varianten": {
            "nshv": {
                "label": "Niederspannungshauptverteilung (NSHV)",
                "wartung": [
                    {"id": "440-NS-01", "text": "Sichtprüfung Schaltanlage: Verschmutzung, Beschädigung, Wärmeentwicklung", "interval_months": 12, "priority": "hoch"},
                    {"id": "440-NS-02", "text": "Schraubverbindungen nachziehen (Klemmenerwärmung vermeiden)", "interval_months": 12, "priority": "hoch"},
                    {"id": "440-NS-03", "text": "Thermografie-Messung unter Last", "interval_months": 12, "priority": "hoch"},
                    {"id": "440-NS-04", "text": "Schutzleiter-Durchgangsprüfung", "interval_months": 48, "priority": "hoch"},
                    {"id": "440-NS-05", "text": "Isolationswiderstand messen", "interval_months": 48, "priority": "hoch"},
                    {"id": "440-NS-06", "text": "Leistungsschalter Funktionstest (manuell und ferngesteuert)", "interval_months": 12, "priority": "hoch"},
                    {"id": "440-NS-07", "text": "Beschriftung und Schaltpläne auf Aktualität prüfen", "interval_months": 12, "priority": "niedrig"},
                    {"id": "440-NS-08", "text": "Kompensationsanlage prüfen (cos phi, Kondensatoren)", "interval_months": 12, "priority": "mittel"},
                ],
            },
            "unterverteilung": {
                "label": "Unterverteilung / Sicherungskasten",
                "wartung": [
                    {"id": "440-UV-01", "text": "Sichtprüfung: Beschriftung, Verdrahtung, Verschmutzung", "interval_months": 12, "priority": "mittel"},
                    {"id": "440-UV-02", "text": "RCD/FI-Schutzschalter Auslösetest (Prüftaste)", "interval_months": 6, "priority": "hoch"},
                    {"id": "440-UV-03", "text": "RCD/FI-Schutzschalter messtechnische Prüfung (Auslösezeit/-strom)", "interval_months": 48, "priority": "hoch"},
                    {"id": "440-UV-04", "text": "Leitungsschutzschalter Funktion prüfen", "interval_months": 48, "priority": "mittel"},
                    {"id": "440-UV-05", "text": "Klemmenverbindungen auf festen Sitz prüfen", "interval_months": 48, "priority": "mittel"},
                ],
            },
            "usv_anlage": {
                "label": "USV-Anlage (Unterbrechungsfreie Stromversorgung)",
                "wartung": [
                    {"id": "440-US-01", "text": "Sichtprüfung USV-Schrank: LEDs, Lüfter, Verschmutzung", "interval_months": 6, "priority": "mittel"},
                    {"id": "440-US-02", "text": "Batterie-Test: Spannung, Innenwiderstand, Kapazität", "interval_months": 6, "priority": "hoch"},
                    {"id": "440-US-03", "text": "Netzausfall-Simulation (Umschalttest Netz→Batterie→Netz)", "interval_months": 12, "priority": "hoch"},
                    {"id": "440-US-04", "text": "Lüfter und Kühlung prüfen, ggf. Filter reinigen", "interval_months": 6, "priority": "mittel"},
                    {"id": "440-US-05", "text": "Batterie-Austausch (Richtwert: alle 3–5 Jahre bei VRLA)", "interval_months": 48, "priority": "hoch"},
                    {"id": "440-US-06", "text": "Firmware/Software-Stand prüfen, ggf. Update", "interval_months": 12, "priority": "niedrig"},
                ],
            },
            "notstrom": {
                "label": "Netzersatzanlage (NEA / Notstromaggregat)",
                "wartung": [
                    {"id": "440-NE-01", "text": "Motor-Ölstand, Kühlmittel, Kraftstoff prüfen", "interval_months": 1, "priority": "hoch"},
                    {"id": "440-NE-02", "text": "Probelauf unter Last (mind. 30 Min., >50% Nennlast)", "interval_months": 1, "priority": "hoch"},
                    {"id": "440-NE-03", "text": "Starterbatterie: Spannung, Ladegerät, Polklemmen", "interval_months": 3, "priority": "hoch"},
                    {"id": "440-NE-04", "text": "Motoröl und Filter wechseln", "interval_months": 12, "priority": "hoch"},
                    {"id": "440-NE-05", "text": "Kühlmittel wechseln, Kühler reinigen", "interval_months": 24, "priority": "mittel"},
                    {"id": "440-NE-06", "text": "Kraftstofffilter und Einspritzdüsen prüfen/wechseln", "interval_months": 12, "priority": "hoch"},
                    {"id": "440-NE-07", "text": "Automatische Netzumschaltung (ATS) Funktionstest", "interval_months": 6, "priority": "hoch"},
                    {"id": "440-NE-08", "text": "Abgasanlage und Schalldämpfer prüfen", "interval_months": 12, "priority": "mittel"},
                    {"id": "440-NE-09", "text": "Tankanlage Dichtheit und Füllstandsanzeige prüfen", "interval_months": 12, "priority": "mittel"},
                ],
            },
            "beleuchtung": {
                "label": "Beleuchtungsanlage",
                "wartung": [
                    {"id": "440-BE-01", "text": "Sichtprüfung aller Leuchten auf Defekte und Verschmutzung", "interval_months": 12, "priority": "mittel"},
                    {"id": "440-BE-02", "text": "Beleuchtungsstärke messen (Lux-Messung nach ASR A3.4)", "interval_months": 24, "priority": "mittel"},
                    {"id": "440-BE-03", "text": "Notbeleuchtung und Sicherheitsbeleuchtung Funktionstest", "interval_months": 1, "priority": "hoch"},
                    {"id": "440-BE-04", "text": "Notbeleuchtung Dauertest (1h bzw. 3h)", "interval_months": 12, "priority": "hoch"},
                    {"id": "440-BE-05", "text": "Lichtsteuerung (DALI, Präsenzmelder, Dämmerungsschalter) prüfen", "interval_months": 12, "priority": "niedrig"},
                    {"id": "440-BE-06", "text": "Defekte Leuchtmittel / LED-Module tauschen", "interval_months": 12, "priority": "mittel"},
                ],
            },
            "blitzschutz": {
                "label": "Blitzschutzanlage",
                "wartung": [
                    {"id": "440-BL-01", "text": "Sichtprüfung Fangeinrichtung und Ableitungen", "interval_months": 12, "priority": "mittel"},
                    {"id": "440-BL-02", "text": "Erdungsanlage: Erdübergangswiderstand messen", "interval_months": 48, "priority": "hoch"},
                    {"id": "440-BL-03", "text": "Überspannungsschutz (SPD Typ 1/2/3) Zustand prüfen", "interval_months": 12, "priority": "hoch"},
                    {"id": "440-BL-04", "text": "Trennstellen und Klemmen auf Korrosion prüfen", "interval_months": 24, "priority": "mittel"},
                    {"id": "440-BL-05", "text": "Blitzschutzdokumentation auf Aktualität prüfen", "interval_months": 48, "priority": "niedrig"},
                ],
            },
        },
    },
    # ──────────────────────────────────────────────────────────────
    # KG 450 – Fernmelde-/Informationstechnik
    # ──────────────────────────────────────────────────────────────
    "450": {
        "label": "Fernmelde-/Informationstechnik",
        "gewerk": "Informationstechnik",
        "varianten": {
            "brandmeldeanlage": {
                "label": "Brandmeldeanlage (BMA)",
                "wartung": [
                    {"id": "450-BM-01", "text": "Brandmeldezentrale (BMZ) Funktionstest und Störmeldungen prüfen", "interval_months": 3, "priority": "hoch"},
                    {"id": "450-BM-02", "text": "Brandmelder Revision: jeden Melder einzeln auslösen und prüfen", "interval_months": 12, "priority": "hoch"},
                    {"id": "450-BM-03", "text": "Handfeuermelder Funktionstest", "interval_months": 3, "priority": "hoch"},
                    {"id": "450-BM-04", "text": "Alarmierungseinrichtungen (Sirenen, Blitzleuchten) prüfen", "interval_months": 3, "priority": "hoch"},
                    {"id": "450-BM-05", "text": "Aufschaltung zur Feuerwehr / Leitstelle testen", "interval_months": 3, "priority": "hoch"},
                    {"id": "450-BM-06", "text": "Feuerwehr-Schlüsseldepot (FSD) Funktion prüfen", "interval_months": 3, "priority": "mittel"},
                    {"id": "450-BM-07", "text": "Rauchansaugsysteme (RAS) reinigen und kalibrieren", "interval_months": 12, "priority": "hoch"},
                    {"id": "450-BM-08", "text": "Brandmelder Verschmutzungskompensation prüfen", "interval_months": 12, "priority": "mittel"},
                    {"id": "450-BM-09", "text": "Betriebsbuch und Feuerwehrlaufkarten aktualisieren", "interval_months": 12, "priority": "mittel"},
                ],
            },
            "einbruchmeldeanlage": {
                "label": "Einbruchmeldeanlage (EMA)",
                "wartung": [
                    {"id": "450-EM-01", "text": "Zentrale: Funktionstest, Störungen und Ereignisspeicher prüfen", "interval_months": 3, "priority": "hoch"},
                    {"id": "450-EM-02", "text": "Bewegungsmelder (PIR/Dual) Erfassungsbereich und Funktion prüfen", "interval_months": 12, "priority": "hoch"},
                    {"id": "450-EM-03", "text": "Magnetkontakte (Tür/Fenster) Funktion prüfen", "interval_months": 12, "priority": "mittel"},
                    {"id": "450-EM-04", "text": "Glasbruchmelder Funktion prüfen", "interval_months": 12, "priority": "mittel"},
                    {"id": "450-EM-05", "text": "Signalgeber (innen/außen) Funktionstest", "interval_months": 3, "priority": "hoch"},
                    {"id": "450-EM-06", "text": "Notstromversorgung (Akku) Kapazität prüfen", "interval_months": 12, "priority": "hoch"},
                    {"id": "450-EM-07", "text": "Aufschaltung zur Notruf-/Serviceleitstelle testen", "interval_months": 3, "priority": "hoch"},
                ],
            },
            "ela_anlage": {
                "label": "Elektroakustische Anlage (ELA / Sprachalarmsystem)",
                "wartung": [
                    {"id": "450-EA-01", "text": "Zentrale und Verstärker Funktionstest", "interval_months": 3, "priority": "hoch"},
                    {"id": "450-EA-02", "text": "Lautsprecherlinien einzeln prüfen (Pegel, Impedanz)", "interval_months": 12, "priority": "hoch"},
                    {"id": "450-EA-03", "text": "Notfall-Durchsage Funktionstest", "interval_months": 3, "priority": "hoch"},
                    {"id": "450-EA-04", "text": "Notstromversorgung und Akku-Kapazität prüfen", "interval_months": 12, "priority": "hoch"},
                    {"id": "450-EA-05", "text": "Sprachverständlichkeit (STI-Messung) prüfen", "interval_months": 24, "priority": "mittel"},
                ],
            },
            "netzwerk": {
                "label": "Netzwerk-Infrastruktur (LAN/WLAN)",
                "wartung": [
                    {"id": "450-NW-01", "text": "Netzwerkschränke Sichtprüfung: Kabelführung, Belüftung, Ordnung", "interval_months": 12, "priority": "mittel"},
                    {"id": "450-NW-02", "text": "Patchfelder und Steckverbindungen auf festen Sitz prüfen", "interval_months": 12, "priority": "mittel"},
                    {"id": "450-NW-03", "text": "Switch/Router: Firmware-Stand, Fehlerlogs, Port-Status prüfen", "interval_months": 6, "priority": "mittel"},
                    {"id": "450-NW-04", "text": "WLAN Access Points: Firmware, Ausleuchtung, Kanalverteilung", "interval_months": 12, "priority": "mittel"},
                    {"id": "450-NW-05", "text": "USV für Netzwerkschränke prüfen (Batterie, Laufzeit)", "interval_months": 6, "priority": "hoch"},
                    {"id": "450-NW-06", "text": "Netzwerk-Dokumentation aktualisieren", "interval_months": 12, "priority": "niedrig"},
                ],
            },
            "videoueberwachung": {
                "label": "Videoüberwachungsanlage (CCTV)",
                "wartung": [
                    {"id": "450-VU-01", "text": "Kameras Sichtprüfung: Ausrichtung, Verschmutzung, Beschädigung", "interval_months": 3, "priority": "mittel"},
                    {"id": "450-VU-02", "text": "Kameraobjektive reinigen", "interval_months": 3, "priority": "mittel"},
                    {"id": "450-VU-03", "text": "Aufzeichnung prüfen: Bildqualität, Speicherdauer, Zeitstempel", "interval_months": 3, "priority": "hoch"},
                    {"id": "450-VU-04", "text": "Rekorder/Server: Festplattenstatus, Firmware, Speicherplatz", "interval_months": 6, "priority": "hoch"},
                    {"id": "450-VU-05", "text": "Nacht-/IR-Beleuchtung Funktion prüfen", "interval_months": 6, "priority": "mittel"},
                    {"id": "450-VU-06", "text": "Netzwerk- und Stromversorgung (PoE) prüfen", "interval_months": 12, "priority": "mittel"},
                ],
            },
        },
    },
    # ──────────────────────────────────────────────────────────────
    # KG 460 – Förderanlagen (Fördertechnik)
    # ──────────────────────────────────────────────────────────────
    "460": {
        "label": "Förderanlagen",
        "gewerk": "Fördertechnik",
        "varianten": {
            "personenaufzug_seil": {
                "label": "Personenaufzug (Seilaufzug)",
                "wartung": [
                    {"id": "460-PS-01", "text": "Sicherheitsprüfung nach BetrSichV (ZÜS/TÜV) alle 2 Jahre", "interval_months": 24, "priority": "hoch"},
                    {"id": "460-PS-02", "text": "Tragmittel (Seile/Riemen) Sichtprüfung auf Abrieb und Drahtbrüche", "interval_months": 3, "priority": "hoch"},
                    {"id": "460-PS-03", "text": "Bremse Funktionsprüfung und Bremsbelag-Verschleiß", "interval_months": 6, "priority": "hoch"},
                    {"id": "460-PS-04", "text": "Türantriebe und Türverriegelungen prüfen", "interval_months": 3, "priority": "hoch"},
                    {"id": "460-PS-05", "text": "Lichtvorhang / Türlichtschranke Funktion prüfen", "interval_months": 3, "priority": "mittel"},
                    {"id": "460-PS-06", "text": "Führungsschienen schmieren", "interval_months": 6, "priority": "mittel"},
                    {"id": "460-PS-07", "text": "Notrufeinrichtung (GSM/Festnetz) testen", "interval_months": 1, "priority": "hoch"},
                    {"id": "460-PS-08", "text": "Beleuchtung Fahrkorb und Schacht prüfen", "interval_months": 6, "priority": "mittel"},
                    {"id": "460-PS-09", "text": "Schachtgrube reinigen und Puffer prüfen", "interval_months": 12, "priority": "mittel"},
                    {"id": "460-PS-10", "text": "Geschwindigkeitsbegrenzer und Fangvorrichtung prüfen", "interval_months": 12, "priority": "hoch"},
                    {"id": "460-PS-11", "text": "Steuerung und Frequenzumrichter Funktionstest", "interval_months": 12, "priority": "mittel"},
                ],
            },
            "personenaufzug_hydraulik": {
                "label": "Personenaufzug (Hydraulik)",
                "wartung": [
                    {"id": "460-PH-01", "text": "Sicherheitsprüfung nach BetrSichV (ZÜS/TÜV) alle 2 Jahre", "interval_months": 24, "priority": "hoch"},
                    {"id": "460-PH-02", "text": "Hydrauliköl Stand und Zustand prüfen", "interval_months": 3, "priority": "hoch"},
                    {"id": "460-PH-03", "text": "Hydraulikzylinder und Leitungen auf Leckagen prüfen", "interval_months": 3, "priority": "hoch"},
                    {"id": "460-PH-04", "text": "Hydraulikaggregat: Motor, Pumpe, Ventile prüfen", "interval_months": 6, "priority": "hoch"},
                    {"id": "460-PH-05", "text": "Absinktest durchführen (Druckhalteprüfung)", "interval_months": 6, "priority": "hoch"},
                    {"id": "460-PH-06", "text": "Türantriebe und Türverriegelungen prüfen", "interval_months": 3, "priority": "hoch"},
                    {"id": "460-PH-07", "text": "Notrufeinrichtung testen", "interval_months": 1, "priority": "hoch"},
                    {"id": "460-PH-08", "text": "Beleuchtung Fahrkorb und Schacht prüfen", "interval_months": 6, "priority": "mittel"},
                    {"id": "460-PH-09", "text": "Führungsschienen schmieren", "interval_months": 6, "priority": "mittel"},
                ],
            },
            "lastenaufzug": {
                "label": "Lastenaufzug / Güteraufzug",
                "wartung": [
                    {"id": "460-LA-01", "text": "Sicherheitsprüfung nach BetrSichV (ZÜS/TÜV)", "interval_months": 24, "priority": "hoch"},
                    {"id": "460-LA-02", "text": "Tragmittel Sichtprüfung (Seile/Ketten)", "interval_months": 3, "priority": "hoch"},
                    {"id": "460-LA-03", "text": "Bremse und Fangvorrichtung prüfen", "interval_months": 6, "priority": "hoch"},
                    {"id": "460-LA-04", "text": "Türen und Verriegelungen prüfen", "interval_months": 3, "priority": "hoch"},
                    {"id": "460-LA-05", "text": "Überlastschutz Funktionstest", "interval_months": 6, "priority": "hoch"},
                    {"id": "460-LA-06", "text": "Notrufeinrichtung testen", "interval_months": 1, "priority": "hoch"},
                ],
            },
            "plattformlift": {
                "label": "Plattformlift / Treppenlift / Hebebühne",
                "wartung": [
                    {"id": "460-PL-01", "text": "Sicherheitsprüfung nach BetrSichV (ZÜS/TÜV)", "interval_months": 24, "priority": "hoch"},
                    {"id": "460-PL-02", "text": "Antrieb und Getriebe Sichtprüfung und Schmierung", "interval_months": 12, "priority": "mittel"},
                    {"id": "460-PL-03", "text": "Sicherheitsendschalter und Not-Halt prüfen", "interval_months": 6, "priority": "hoch"},
                    {"id": "460-PL-04", "text": "Plattform-Schürze und Klapprampe prüfen", "interval_months": 12, "priority": "mittel"},
                    {"id": "460-PL-05", "text": "Steuerung und Bedienelemente Funktionstest", "interval_months": 12, "priority": "mittel"},
                ],
            },
        },
    },
    # ──────────────────────────────────────────────────────────────
    # KG 470 – Nutzungsspezifische Anlagen
    # ──────────────────────────────────────────────────────────────
    "470": {
        "label": "Nutzungsspezifische Anlagen",
        "gewerk": "Verfahrenstechnik",
        "varianten": {
            "buehnentechnik_ober": {
                "label": "Bühnentechnik (Obermaschinerie)",
                "wartung": [
                    {"id": "470-BO-01", "text": "Seilzüge und Prospektzüge: Seile, Rollen, Bremsen prüfen", "interval_months": 6, "priority": "hoch"},
                    {"id": "470-BO-02", "text": "Schnürboden Tragfähigkeit und Zustand prüfen", "interval_months": 12, "priority": "hoch"},
                    {"id": "470-BO-03", "text": "Beleuchtungszüge und Brücken Tragmittel prüfen", "interval_months": 6, "priority": "hoch"},
                    {"id": "470-BO-04", "text": "Eiserner Vorhang / Schutzvorhang Funktionstest", "interval_months": 3, "priority": "hoch"},
                    {"id": "470-BO-05", "text": "Not-Halt und Sicherheitseinrichtungen prüfen", "interval_months": 3, "priority": "hoch"},
                    {"id": "470-BO-06", "text": "Steuerung und SPS Funktionstest", "interval_months": 12, "priority": "mittel"},
                ],
            },
            "buehnentechnik_unter": {
                "label": "Bühnentechnik (Untermaschinerie)",
                "wartung": [
                    {"id": "470-BU-01", "text": "Bühnenwagen und Drehbühne: Antriebe, Führungen, Bremsen prüfen", "interval_months": 6, "priority": "hoch"},
                    {"id": "470-BU-02", "text": "Versenkungen und Podien: Hubmechanik prüfen", "interval_months": 6, "priority": "hoch"},
                    {"id": "470-BU-03", "text": "Hydraulikanlage: Ölstand, Drücke, Leckagen prüfen", "interval_months": 6, "priority": "hoch"},
                    {"id": "470-BU-04", "text": "Not-Halt und Sicherheitseinrichtungen prüfen", "interval_months": 3, "priority": "hoch"},
                    {"id": "470-BU-05", "text": "Orchestergraben-Podium Hubmechanik prüfen", "interval_months": 6, "priority": "hoch"},
                ],
            },
            "grosskueche": {
                "label": "Großküchentechnik",
                "wartung": [
                    {"id": "470-GK-01", "text": "Gasgeräte: Flammenüberwachung und Zündsicherung prüfen", "interval_months": 12, "priority": "hoch"},
                    {"id": "470-GK-02", "text": "Küchenabluft: Fettfilter reinigen", "interval_months": 1, "priority": "hoch"},
                    {"id": "470-GK-03", "text": "Küchenabluftkanal und -ventilator reinigen", "interval_months": 6, "priority": "hoch"},
                    {"id": "470-GK-04", "text": "Kühlgeräte: Temperaturen, Verdampfer, Kondensator prüfen", "interval_months": 6, "priority": "hoch"},
                    {"id": "470-GK-05", "text": "Spülmaschine: Dosierung, Temperaturen, Dichtungen prüfen", "interval_months": 3, "priority": "mittel"},
                    {"id": "470-GK-06", "text": "Fettabscheider entleeren und reinigen", "interval_months": 3, "priority": "hoch"},
                ],
            },
        },
    },
    # ──────────────────────────────────────────────────────────────
    # KG 480 – Gebäudeautomation (MSR-/Gebäudeautomation)
    # ──────────────────────────────────────────────────────────────
    "480": {
        "label": "Gebäudeautomation",
        "gewerk": "MSR-/Gebäudeautomation",
        "varianten": {
            "ddc_station": {
                "label": "DDC-Automationsstation",
                "wartung": [
                    {"id": "480-DD-01", "text": "Automationsstation Funktionstest: CPU-Auslastung, Speicher, Lüfter", "interval_months": 12, "priority": "mittel"},
                    {"id": "480-DD-02", "text": "Sensoren kalibrieren: Temperatur, Feuchte, Druck, CO₂", "interval_months": 12, "priority": "hoch"},
                    {"id": "480-DD-03", "text": "Stellantriebe und Aktoren Funktion und Stellbereich prüfen", "interval_months": 12, "priority": "hoch"},
                    {"id": "480-DD-04", "text": "Regelkreise abstimmen und optimieren", "interval_months": 12, "priority": "mittel"},
                    {"id": "480-DD-05", "text": "Datenpunkte auf Plausibilität prüfen", "interval_months": 12, "priority": "mittel"},
                    {"id": "480-DD-06", "text": "Datensicherung der Programmierung erstellen", "interval_months": 6, "priority": "hoch"},
                    {"id": "480-DD-07", "text": "Firmware-Version prüfen, ggf. Update", "interval_months": 12, "priority": "niedrig"},
                ],
            },
            "glt": {
                "label": "Gebäudeleittechnik (GLT / Managementebene)",
                "wartung": [
                    {"id": "480-GL-01", "text": "GLT-Server: Betriebssystem-Updates und Sicherheitspatches", "interval_months": 3, "priority": "hoch"},
                    {"id": "480-GL-02", "text": "Datensicherung GLT-Datenbank und Konfiguration", "interval_months": 3, "priority": "hoch"},
                    {"id": "480-GL-03", "text": "Trendaufzeichnungen und Speicherplatz prüfen", "interval_months": 6, "priority": "mittel"},
                    {"id": "480-GL-04", "text": "Alarme, Grenzwerte und Eskalationsketten prüfen", "interval_months": 6, "priority": "hoch"},
                    {"id": "480-GL-05", "text": "Benutzerkonten und Zugriffsrechte prüfen", "interval_months": 12, "priority": "mittel"},
                    {"id": "480-GL-06", "text": "Kommunikation zu Feldebene (BACnet/Modbus) prüfen", "interval_months": 12, "priority": "mittel"},
                    {"id": "480-GL-07", "text": "Zeitprogramme und Kalender aktualisieren", "interval_months": 12, "priority": "niedrig"},
                ],
            },
            "knx": {
                "label": "KNX/EIB-Installation",
                "wartung": [
                    {"id": "480-KN-01", "text": "KNX-Spannungsversorgung und Busspannung prüfen", "interval_months": 12, "priority": "hoch"},
                    {"id": "480-KN-02", "text": "Aktoren und Sensoren Funktionstest", "interval_months": 12, "priority": "mittel"},
                    {"id": "480-KN-03", "text": "Programmierung sichern (ETS-Projektdatei)", "interval_months": 12, "priority": "hoch"},
                    {"id": "480-KN-04", "text": "Busmonitor: Telegrammfehler und Busauslastung prüfen", "interval_months": 12, "priority": "mittel"},
                    {"id": "480-KN-05", "text": "Logikfunktionen und Szenen Funktionstest", "interval_months": 12, "priority": "niedrig"},
                ],
            },
        },
    },
    # ──────────────────────────────────────────────────────────────
    # KG 490 – Sonstige Maßnahmen für technische Anlagen
    # ──────────────────────────────────────────────────────────────
    "490": {
        "label": "Sonstige Maßnahmen für techn. Anlagen",
        "gewerk": "Sonstige",
        "varianten": {
            "allgemein": {
                "label": "Allgemeine technische Anlage",
                "wartung": [
                    {"id": "490-AL-01", "text": "Allgemeine Sichtprüfung auf Beschädigungen und Verschleiß", "interval_months": 12, "priority": "mittel"},
                    {"id": "490-AL-02", "text": "Funktionstest aller sicherheitsrelevanten Einrichtungen", "interval_months": 12, "priority": "hoch"},
                    {"id": "490-AL-03", "text": "Dokumentation prüfen und aktualisieren", "interval_months": 12, "priority": "niedrig"},
                    {"id": "490-AL-04", "text": "Reinigung und Pflege durchführen", "interval_months": 12, "priority": "niedrig"},
                    {"id": "490-AL-05", "text": "Verschleißteile prüfen und ggf. ersetzen", "interval_months": 12, "priority": "mittel"},
                ],
            },
        },
    },
}

# Abwärtskompatibilität: DIN276_KOSTENGRUPPEN aus VDMA_ANLAGEN ableiten.
DIN276_KOSTENGRUPPEN = {
    kg: {"label": data["label"], "gewerk": data["gewerk"]}
    for kg, data in VDMA_ANLAGEN.items()
}


def get_varianten_for_kg(kg: str) -> list[dict] | None:
    """Gibt alle Anlagenvarianten für eine Kostengruppe zurück."""
    data = VDMA_ANLAGEN.get(kg)
    if not data:
        return None
    result = []
    for key, variante in data["varianten"].items():
        result.append({
            "key": key,
            "label": variante["label"],
            "wartung_count": len(variante["wartung"]),
        })
    return result


def get_checklist_for_variante(kg: str, variante_key: str) -> list[dict] | None:
    """Gibt die Wartungscheckliste für eine bestimmte Anlagenvariante zurück."""
    data = VDMA_ANLAGEN.get(kg)
    if not data:
        return None
    variante = data["varianten"].get(variante_key)
    if not variante:
        return None
    return variante["wartung"]


def get_template_for_kg(kg: str, variante_key: str | None = None) -> dict | None:
    """Gibt die vollständige VDMA-Vorlage für eine Kostengruppe zurück.
    Wenn variante_key angegeben, wird die Checkliste der Variante zurückgegeben.
    Sonst die Checkliste der ersten Variante (Abwärtskompatibilität)."""
    data = VDMA_ANLAGEN.get(kg)
    if not data:
        return None

    varianten = data["varianten"]
    checklist = []

    if variante_key and variante_key in varianten:
        checklist = varianten[variante_key]["wartung"]
    elif varianten:
        # Erste Variante als Default
        first_key = next(iter(varianten))
        checklist = varianten[first_key]["wartung"]

    return {
        "kg": kg,
        "label": data["label"],
        "gewerk": data["gewerk"],
        "checklist": checklist,
        "varianten": [
            {"key": k, "label": v["label"], "wartung_count": len(v["wartung"])}
            for k, v in varianten.items()
        ],
    }


def get_all_templates() -> list[dict]:
    """Gibt alle VDMA-Vorlagen zurück (mit Varianten-Info, ohne Checklisten-Details)."""
    result = []
    for kg in sorted(VDMA_ANLAGEN.keys()):
        data = VDMA_ANLAGEN[kg]
        result.append({
            "kg": kg,
            "label": data["label"],
            "gewerk": data["gewerk"],
            "checklist": [],  # Leer — Checkliste wird per Variante geladen
            "varianten": [
                {"key": k, "label": v["label"], "wartung_count": len(v["wartung"])}
                for k, v in data["varianten"].items()
            ],
        })
    return result
