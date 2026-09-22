from pathlib import Path

from docx_generator import convert_json_to_docx, open_document

script_directory = Path(__file__).resolve().parent

json_file_input = script_directory / "template" / "text-input-example.json"

json_string_input = """{
  "[machinenummer]": "MCH-2024-00158",
  "[distributeur]": "Distributor B.V.",
  "[naam monteur]": "Joost Klein",
  "[contactpersoon]": "Peter Brown",
  "[klant]": "Customer Ltd.",
  "[tijdverschil]": "+1",

  "[datum]": "16-09-2026",
  "[engineer]": "John Smith",
  "[goedgekeurd]": "Smith John",
  "[datum / tijd]": "16-09-2026 / 14:30",

  "[telefoonnummer en/of e-mailadres]": "peter.brown@example.com / +31 6 12345678",
  "[taal]": "English",
  "[naam van Repak medewerker die melding aangenomen heeft]": "John Smith",
  "[machine staat stil / productie beperkt / machine in productie]": "machine is down",
  "[audio link]": "https://audio.website.com/9f33nt9gievnrk",
  "[betrouwbaarheid transcriptie hoog / gemiddeld / laag]": "medium",
  "[tijdstippen of toelichting]": "00:42-00:48: Background noise makes the description of the affected station unclear. The caller clearly states error code E204.",

  "[transcriptie]": "Good afternoon, we have had a problem with machine MCH-2024-00158 since this morning. The machine runs for about twenty minutes and then stops with error code E204. We have already restarted the machine twice. It works again for a short time, but the fault keeps returning. The machine is currently stopped and we need it for today's production.",
  "[probleem]": "The machine stops during production after approximately 20 minutes. Error code E204 appears on the control panel. After restarting, the machine works temporarily, but the problem returns.",
  "[alarmcode of exacte tekst]": "E204",
  "[onderdeel of station]": "Not yet confirmed; the relevant part of the recording is unclear.",
  "[datum / tijd / situatie]": "16-09-2026, during morning production, after approximately 20 minutes of operation.",
  "[eenmalig / af en toe / continu]": "intermittent",
  "[symptomen]": "The machine stops after approximately 20 minutes of production and displays error code E204. Restarting temporarily restores operation.",
  "[acties en resultaten]": "The customer restarted the machine twice. Each restart restored operation temporarily, but the same fault returned.",
  "[onderhoud / instellingen / onderdelen / software]": "No recent changes were mentioned during the call. Confirm whether maintenance, settings, parts, or software have changed.",

  "[ontbrekende informatie]": "The exact alarm text, affected station, operating conditions, software version, and recent maintenance history are not yet known.",
  "[vragen]": "Can you send a photo of the complete alarm message? Which station is affected? Does the fault always occur after approximately 20 minutes? Have any settings, parts, or software changed recently?",
  "[oorzaak]": "The root cause is not yet established. An intermittent fault that develops during operation is suspected, pending confirmation of the meaning of E204 for this machine.",
  "[oorzaken]": "Possible alternatives to investigate include a loose connection, an intermittent sensor fault, or a temperature-related issue. None has been confirmed.",
  "[feiten uit melding en kennisbron]": "The caller reports repeated stops after approximately 20 minutes and only temporary recovery after restarting. No verified knowledge source has been found yet, so the meaning of E204 and the suspected causes remain unconfirmed.",
  "[zekerheid analyse hoog / gemiddeld / laag]": "High",

  "[zoekvraag]": "What does error code E204 mean for machine MCH-2024-00158, and which diagnostic steps apply when the machine stops after approximately 20 minutes?",
  "[zoektermen]": "MCH-2024-00158, E204, intermittent stop, 20 minutes, restart",
  "[bronnen]": "No knowledge sources have been searched yet. Planned sources are the machine manual, service information sheets, and previous service reports.",
  "[documentnaam, documentnummer en versie]": "No verified document has been identified yet.",
  "[map of koppeling]": "Not yet available; add the location of the verified source document.",
  "[datum van bron]": "16-08-2025",
  "[relevantie van zoekresultaat hoog / gemiddeld / laag]": "laag",
  "[conceptadvies]": "Switch off the machine safely, check for visible blockages or loose connections, and do not restart the machine if error code E204 immediately returns. Record the conditions under which the error occurs and wait for further instructions from the engineer.",
  "[documentnaam, documentnummer, versie, paragraaf of pagina]": "Source references are pending. Have the engineer verify each advice step against the applicable machine documentation.",
  "[afwijkingen of onzekerheden]": "The affected station is unclear in the recording, the meaning of E204 has not been verified, and no source document is available yet."
}"""

file = convert_json_to_docx(json_string_input)
open_document(file)

