/**
 * Teltonika element names in Lithuanian, keyed by PATTERN — every run of digits is a `{}`.
 *
 * Ordered roughly by how often the name occurs across the 37 shipped dictionaries, so the entries
 * that matter most are the ones a reader of this file meets first. A translation must carry the
 * same number of `{}` in the same order as its key; `avlNames.spec` fails otherwise, because a
 * dropped placeholder would silently merge "Tire 1" and "Tire 4" into one row.
 *
 * Untranslated patterns are not listed. `translateAvlName` returns the English name for those,
 * which is the whole reason this table can grow one line at a time.
 */
export const AVL_NAMES_LT: Readonly<Record<string, string>> = {
  // ── geofences, generic families ────────────────────────────────────────────
  'Geofence zone {}': 'Geozona {}',
  'Auto Geofence': 'Automatinė geozona',
  'Manual CAN {}': 'Rankinis CAN {}',
  'Custom scenario {}': 'Pasirinktinis scenarijus {}',
  'Custom Scenario {}': 'Pasirinktinis scenarijus {}',

  // ── power ─────────────────────────────────────────────────────────────────
  'Battery Voltage': 'Akumuliatoriaus įtampa',
  'Battery Voltage {}': 'Akumuliatoriaus įtampa {}',
  'Battery Current': 'Akumuliatoriaus srovė',
  'Battery Level': 'Akumuliatoriaus lygis',
  'Battery level': 'Akumuliatoriaus lygis',
  'External Voltage': 'Išorinė įtampa',
  'Low Battery {}': 'Senka akumuliatorius {}',
  'Unplug': 'Atjungtas maitinimas',
  'Alternator Status {}': 'Generatoriaus būsena {}',

  // ── movement, position ────────────────────────────────────────────────────
  Ignition: 'Degimas',
  Movement: 'Judėjimas',
  'Instant Movement': 'Momentinis judėjimas',
  'Movement Count {}': 'Judėjimų skaičius {}',
  Speed: 'Greitis',
  'Vehicle Speed': 'Automobilio greitis',
  'Over Speeding': 'Greičio viršijimas',
  Idling: 'Tuščioji eiga',
  Towing: 'Vilkimas',
  'Crash detection': 'Susidūrimo aptikimas',
  'Crash trace data': 'Susidūrimo įrašo duomenys',
  'Total Odometer': 'Bendra rida',
  'Trip Odometer': 'Kelionės rida',
  'Total Mileage': 'Bendra rida',
  'Total Mileage (counted)': 'Bendra rida (skaičiuota)',
  Trip: 'Kelionė',
  'Axis X': 'X ašis',
  'Axis Y': 'Y ašis',
  'Axis Z': 'Z ašis',
  'Pitch {}': 'Posvyris {}',
  'Roll {}': 'Šoninis posvyris {}',

  // ── GNSS ──────────────────────────────────────────────────────────────────
  'GNSS Status': 'GNSS būsena',
  'GNSS HDOP': 'GNSS HDOP',
  'GNSS PDOP': 'GNSS PDOP',
  'ISO{} Coordinates': 'ISO{} koordinatės',

  // ── network ───────────────────────────────────────────────────────────────
  'GSM Signal': 'GSM signalas',
  'GSM Cell ID': 'GSM celės ID',
  'GSM Cell ID {}': 'GSM celės ID {}',
  'GSM Area Code': 'GSM zonos kodas',
  'GSM Cell LAC {}': 'GSM celės LAC {}',
  'GSM Cell MNC {}': 'GSM celės MNC {}',
  'GSM operator code': 'GSM operatoriaus kodas',
  'Active GSM Operator': 'Aktyvus GSM operatorius',
  'GSM Signal RX {}': 'GSM signalas RX {}',
  'LTE Signal RX {}': 'LTE signalas RX {}',
  'LTE Cell LAC {}': 'LTE celės LAC {}',
  'LTE Cell ID {}': 'LTE celės ID {}',
  'LTE Cell MNC {}': 'LTE celės MNC {}',
  'Network Type': 'Tinklo tipas',
  'Connectivity quality': 'Ryšio kokybė',
  Jamming: 'Signalo slopinimas',
  'ICCID{}': 'ICCID{}',
  'CCID Part{}': 'CCID dalis {}',
  'Neighbouring Cell {} LAC': 'Gretimos celės {} LAC',
  'Neighbouring Cell {} ID': 'Gretimos celės {} ID',
  'Neighbouring Cell {} RSSI': 'Gretimos celės {} RSSI',
  'Neighbouring Cell {} MNC': 'Gretimos celės {} MNC',
  'Neighbouring Cell {} MCC': 'Gretimos celės {} MCC',

  // ── device state ──────────────────────────────────────────────────────────
  'Sleep Mode': 'Miego režimas',
  'Data Mode': 'Duomenų režimas',
  'SD Status': 'SD kortelės būsena',
  'BT Status': 'Bluetooth būsena',
  'PCB Temperature': 'Plokštės temperatūra',
  'PCB temperature': 'Plokštės temperatūra',
  'Module ID {}B': 'Modulio ID {}B',
  Alarm: 'Pavojaus signalas',
  'Alarm {}': 'Pavojaus signalas {}',
  'Status {}': 'Būsena {}',
  Immobilizer: 'Imobilizatorius',
  iButton: 'iButton raktas',
  RFID: 'RFID',
  'User ID': 'Naudotojo ID',

  // ── inputs and outputs ────────────────────────────────────────────────────
  'Digital Input {}': 'Skaitmeninė įvestis {}',
  'Digital Output {}': 'Skaitmeninė išvestis {}',
  'Digital Output {} Overcurrent': 'Skaitmeninės išvesties {} viršsrovė',
  'Analog Input {}': 'Analoginė įvestis {}',
  'Input {}': 'Įvestis {}',
  'Frequency DIN{}': 'DIN{} dažnis',
  'Pulse Counter Din{}': 'DIN{} impulsų skaitiklis',
  'Pulse counter DIN{}': 'DIN{} impulsų skaitiklis',
  'Impulse counter value {}': 'Impulsų skaitiklio reikšmė {}',
  'Impulse counter frequency {}': 'Impulsų skaitiklio dažnis {}',
  'Impulse counter RPM {}': 'Impulsų skaitiklio sūkiai {}',
  'External Digital Sensor {}': 'Išorinis skaitmeninis jutiklis {}',

  // ── engine and fuel ───────────────────────────────────────────────────────
  'Engine RPM': 'Variklio sūkiai',
  'Engine Load': 'Variklio apkrova',
  'Engine Oil Temperature': 'Variklio alyvos temperatūra',
  'Engine Coolant Temperature': 'Variklio aušinimo skysčio temperatūra',
  'Coolant Temperature': 'Aušinimo skysčio temperatūra',
  'Ambient Air Temperature': 'Aplinkos oro temperatūra',
  'Fuel Level': 'Kuro lygis',
  'Fuel Rate': 'Kuro sąnaudos',
  'Fuel Consumed (counted)': 'Sunaudota kuro (skaičiuota)',
  'Throttle position': 'Akceleratoriaus padėtis',
  'Engine Total Hours (counted)': 'Bendras variklio laikas (skaičiuotas)',
  'Ignition On Counter': 'Degimo įjungimų skaitiklis',
  VIN: 'VIN kodas',
  'Vehicle Identification Number Part{}': 'VIN kodo dalis {}',
  'Fault Codes': 'Gedimų kodai',

  // ── driving quality ───────────────────────────────────────────────────────
  'Green Driving Value': 'Ekonomiško vairavimo reikšmė',
  'Green driving type': 'Ekonomiško vairavimo tipas',
  'Green driving event duration': 'Ekonomiško vairavimo įvykio trukmė',
  'Eco Score': 'Ekonomiškumo įvertis',
  EcoMaximum: 'Ekonomiškumas, didžiausias',
  EcoAverage: 'Ekonomiškumas, vidutinis',
  EcoDuration: 'Ekonomiškumo trukmė',

  // ── doors ─────────────────────────────────────────────────────────────────
  'Door Status': 'Durų būsena',
  'Door {} Lock Status': 'Durų {} užrakto būsena',

  // ── tyres and axles ───────────────────────────────────────────────────────
  'Tire {} pressure': '{} padangos slėgis',
  'Tire {} Temperature': '{} padangos temperatūra',
  'Tire {} Warning': '{} padangos įspėjimas',
  'EBS Tyre {} Pressure': 'EBS {} padangos slėgis',
  'EBS Tyre {} Temperature': 'EBS {} padangos temperatūra',
  'EBS Tyre {} Status': 'EBS {} padangos būsena',
  'EBS Tyre {} Position': 'EBS {} padangos padėtis',
  'EBS Tyre {} Additional Data {}': 'EBS {} padangos papildomi duomenys {}',
  'Axle weight {}': '{} ašies svoris',
  'Axle {} Load': '{} ašies apkrova',

  // ── temperature and environment sensors ───────────────────────────────────
  'Temperature {}': 'Temperatūra {}',
  'Humidity {}': 'Drėgnis {}',
  'Magnet {}': 'Magnetas {}',
  'RSSI {}': 'RSSI {}',
  'MAC address {}': 'MAC adresas {}',
  'Name {}': 'Pavadinimas {}',
  'Dallas Temperature {}': 'Dallas temperatūra {}',
  'Dallas Temperature ID {}': 'Dallas temperatūros jutiklio ID {}',
  'Temperature Probe {}': 'Temperatūros zondas {}',
  'External Temperature {}': 'Išorinė temperatūra {}',
  'External Sensor Temperature {}': 'Išorinio jutiklio temperatūra {}',
  '{}Wire Humidity {}': '{}-laidžio drėgnis {}',
  'Sensor {} Unit': 'Jutiklio {} matmuo',

  // ── BLE / EYE sensors ─────────────────────────────────────────────────────
  'BLE {} Custom #{}': 'BLE {} pasirinktinis #{}',
  'BLE Battery {}': 'BLE akumuliatorius {}',
  'BLE Temperature {}': 'BLE temperatūra {}',
  'BLE Humidity {}': 'BLE drėgnis {}',
  'BLE Sensor Custom {}': 'BLE jutiklis, pasirinktinis {}',
  'BLE Button {} state #{}': 'BLE mygtuko {} būsena #{}',
  'BLE RFID #{}': 'BLE RFID #{}',
  'BLE Fuel Level #{}': 'BLE kuro lygis #{}',
  'BLE Fuel Frequency #{}': 'BLE kuro dažnis #{}',
  'BLE Luminosity #{}': 'BLE apšvieta #{}',
  'BLE{} EYE sensor lost alarm': 'BLE{} EYE jutiklio dingimo signalas',
  'EYE Temperature {}': 'EYE temperatūra {}',
  'EYE Humidity {}': 'EYE drėgnis {}',
  'EYE Magnet {}': 'EYE magnetas {}',
  'EYE Movement {}': 'EYE judėjimas {}',
  'EYE Pitch {}': 'EYE posvyris {}',
  'EYE Roll {}': 'EYE šoninis posvyris {}',
  'EYE Low Battery {}': 'EYE senka akumuliatorius {}',
  'EYE Battery Voltage {}': 'EYE akumuliatoriaus įtampa {}',
  'EYE Movement count {}': 'EYE judėjimų skaičius {}',
  'EYE Magnet count {}': 'EYE magneto suveikimų skaičius {}',

  // ── fuel-level sensors (LLS / Escort) ─────────────────────────────────────
  'LLS {} Fuel Level': 'LLS {} kuro lygis',
  'LLS {} Temperature': 'LLS {} temperatūra',
  'Escort LLS Fuel level #{}': 'Escort LLS kuro lygis #{}',
  'Escort LLS Temperature #{}': 'Escort LLS temperatūra #{}',
  'Escort LLS Battery Voltage #{}': 'Escort LLS akumuliatoriaus įtampa #{}',

  // ── tachograph / driver ───────────────────────────────────────────────────
  'Driver {} Continuous Driving Time': 'Vairuotojo {} nepertraukiamo vairavimo laikas',
  'Driver {} Cumulative Driving Time': 'Vairuotojo {} bendras vairavimo laikas',
  'Driver {} Cumulative Break Time': 'Vairuotojo {} bendras poilsio laikas',
  'Driver {} Selected Activity Duration': 'Vairuotojo {} pasirinktos veiklos trukmė',
  'Driver {} Working State': 'Vairuotojo {} darbo būsena',
  'Driver {} Card Presence': 'Vairuotojo {} kortelės buvimas',
  'Driver {} Time Related States': 'Vairuotojo {} su laiku susijusios būsenos',
  'Card {} Issuing Member State': 'Kortelę {} išdavusi valstybė',

  // ── ranges (FMS eco reports) ──────────────────────────────────────────────
  'Speed Range {} Distance': 'Greičio ruožo {} atstumas',
  'Speed Range {} Fuel used': 'Greičio ruožo {} sunaudotas kuras',
  'Speed Range {} Time': 'Greičio ruožo {} laikas',
  'RPM Range {} Distance': 'Sūkių ruožo {} atstumas',
  'RPM Range {} Fuel used': 'Sūkių ruožo {} sunaudotas kuras',
  'RPM Range {} Time': 'Sūkių ruožo {} laikas',
  'Torque Range {} Distance': 'Sukimo momento ruožo {} atstumas',
  'Torque Range {} Fuel used': 'Sukimo momento ruožo {} sunaudotas kuras',
  'Torque Range {} Time': 'Sukimo momento ruožo {} laikas',
  'Braking Range {} Distance': 'Stabdymo ruožo {} atstumas',
  'Braking Range {} Fuel used': 'Stabdymo ruožo {} sunaudotas kuras',
  'Braking Range {} Time': 'Stabdymo ruožo {} laikas',

  // ── maintenance ───────────────────────────────────────────────────────────
  'Maintenance {} Hours': 'Techninės priežiūros {} valandos',
  'Tell Tale {}': 'Prietaisų skydelio indikatorius {}',

  // ── spellings Teltonika uses for the same concept on OTHER tables. The catalogue is not
  //    self-consistent: `Engine RPM` and `Engine Speed`, `(counted)` and `Counted`, `GSM Signal`
  //    and `GSM signal` all ship. Every one of these was reported by a live device in the last
  //    seven days and rendered in English until it was listed here.
  'Engine Speed': 'Variklio sūkiai',
  'Fuel Consumed Counted': 'Sunaudota kuro (skaičiuota)',
  'GSM signal': 'GSM signalas',
  'Throttle Position': 'Akceleratoriaus padėtis',
  'Total Mileage Counted': 'Bendra rida (skaičiuota)',
  'Control State Flags': 'Valdymo būsenos vėliavos',
  'Security State Flags': 'Saugos būsenos vėliavos',
  'Accel Calibration Quality': 'Akselerometro kalibravimo kokybė',
  'Current Active Log File': 'Dabartinis žurnalo failas',
  'Max Log File Count': 'Didžiausias žurnalo failų skaičius',
  'Side Vector Delta': 'Šoninio vektoriaus pokytis',
}
