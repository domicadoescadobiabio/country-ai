// Building catalogue for the COUNTRY AI map.
// Each AI citizen stands for REP real residents, so a city of 2,000 agents is drawn as a town of ~50,000 people
// and gets the facilities a real town of that size has (planning ratios from the research in
// research_notes/Katalog bangunan negara nyata/). `per` = represented residents served by one facility.
export const REP = 25;

export const CATS = {
  gov: { label: 'Government', color: '#e9e4d8' },
  justice: { label: 'Justice', color: '#b9a37a' },
  police: { label: 'Police', color: '#3b6fd8' },
  military: { label: 'Military', color: '#5f7a4a' },
  civic: { label: 'Public services', color: '#e7b04a' },
  edu: { label: 'Education', color: '#d9763a' },
  health: { label: 'Health', color: '#f2f2f2' },
  economy: { label: 'Shops & markets', color: '#e05a7a' },
  work: { label: 'Offices & industry', color: '#7f8fa6' },
  housing: { label: 'Housing', color: '#d8c3a5' },
  public: { label: 'Parks & public space', color: '#5aa469' },
  infra: { label: 'Infrastructure', color: '#8a8f99' },
};

// size: 'lot' = one lot inside a housing block, [bw, bd] = whole blocks.
// where: core | inner | mid | outer | edge | coast | river
export const TYPES = {
  // --- national government (capital only, placed by the capital plan)
  palace: { name: 'Presidential Palace', cat: 'gov', size: [2, 2], seat: ['president'], desc: 'Office and residence of the President. Orders, vetoes and appointments are signed here.' },
  vp_office: { name: 'Vice President\'s Office', cat: 'gov', size: [1, 1], seat: ['vice_president'], desc: 'Office of the Vice President, beside the palace.' },
  parliament: { name: 'Council House', cat: 'gov', size: [2, 2], seat: ['council'], desc: 'The 30-seat Council debates, votes bills and confirms ministers here.' },
  ministry: { name: 'Ministry', cat: 'gov', size: [1, 1], desc: 'A ministry led by a minister nominated by the President and confirmed by the Council.' },
  const_court: { name: 'Constitutional Court', cat: 'justice', size: [1, 1], seat: ['judge'], desc: 'Five judges rule on appointments, elections, impeachments and criminal trials.' },
  election_comm: { name: 'Election & Audit Commission', cat: 'gov', size: [1, 1], seat: ['commissioner'], desc: 'Runs elections, recounts every ballot and audits the treasury.' },
  central_bank: { name: 'Central Bank & Treasury', cat: 'gov', size: [1, 1], desc: 'Holds the national treasury in CAI and pays wages, UBI and city budgets.' },
  monument: { name: 'National Monument', cat: 'public', size: [2, 2], desc: 'The national square and its monument at the heart of the capital.' },
  national_archive: { name: 'National Ledger Archive', cat: 'gov', size: [1, 1], desc: 'Keeps the hash-chained national ledger: every law, vote and payment.' },
  academy: { name: 'National Academy', cat: 'edu', size: [2, 2], desc: 'Trains and examines candidates for every public office.' },
  police_hq: { name: 'National Police HQ', cat: 'police', size: [1, 1], seat: ['police_chief'], desc: 'Headquarters of the Chief of Police.' },
  military_hq: { name: 'Defence HQ', cat: 'military', size: [1, 1], seat: ['military_chief'], desc: 'Headquarters of the Commander of the Military.' },
  army_base: { name: 'Army Base', cat: 'military', size: [3, 3], seat: ['military'], desc: 'Barracks, parade ground, motor pool and armoury.' },
  military_academy: { name: 'Military Academy & Training Ground', cat: 'military', size: [3, 2], desc: 'Officer school, obstacle course and firing range.' },
  police_academy: { name: 'Police Academy & Training Centre', cat: 'police', size: [3, 2], desc: 'Recruit school, driving track, shooting range and forensics lab.' },
  naval_base: { name: 'Naval Base', cat: 'military', size: [3, 2], desc: 'Piers, patrol boats and the coast guard.' },
  air_base: { name: 'Air Base', cat: 'military', size: [4, 2], desc: 'Runway, hangars and the air defence radar.' },
  prison: { name: 'National Prison', cat: 'justice', size: [2, 2], desc: 'Walled prison for convicted citizens.' },
  border_post: { name: 'Border Post', cat: 'military', size: 'lot', desc: 'Checkpoint where soldiers screen immigrants and visitors.' },
  stadium: { name: 'National Stadium', cat: 'public', size: [2, 2], desc: 'Sports, ceremonies and election-night rallies.' },
  university: { name: 'University', cat: 'edu', size: [2, 2], desc: 'Faculties, library and research labs.' },
  airport: { name: 'International Airport', cat: 'infra', size: [5, 2], desc: 'Terminal, control tower and runway.' },

  // --- city government & justice
  city_hall: { name: 'City Hall', cat: 'gov', size: [1, 1], seat: ['mayor'], desc: 'The mayor spends the city budget here.' },
  court: { name: 'District Court', cat: 'justice', size: [1, 1], desc: 'Hearings for arrests, fines and debts.' },
  jail: { name: 'Remand Jail', cat: 'justice', size: 'lot', desc: 'Holds arrested citizens before trial (max 3 days).' },
  civil_office: { name: 'District Office', cat: 'gov', size: 'lot', per: 25000, min: 1, where: 'mid', desc: 'Civil registry, permits and local services.' },

  // --- police (pyramid: national HQ > city station > neighbourhood post)
  police_station: { name: 'Police Station', cat: 'police', size: [1, 1], per: 25000, min: 1, where: 'inner', seat: ['police'], desc: 'City police station with cells, patrol cars and a duty desk.' },
  police_post: { name: 'Police Post', cat: 'police', size: 'lot', per: 7000, min: 3, where: 'any', seat: ['police'], desc: 'Neighbourhood police box, the first stop for a report.' },
  police_housing: { name: 'Police Housing', cat: 'housing', size: [1, 1], per: 50000, min: 1, where: 'mid', desc: 'Dormitories and family quarters for police officers.' },
  military_housing: { name: 'Military Housing', cat: 'housing', size: [1, 1], desc: 'Barracks quarters and family housing for soldiers.' },

  // --- public services
  fire_station: { name: 'Fire Station', cat: 'civic', size: 'lot', per: 20000, min: 1, where: 'any', desc: 'Engines, ladder truck and rescue crew.' },
  post_office: { name: 'Post Office', cat: 'civic', size: 'lot', per: 30000, min: 1, where: 'inner', desc: 'Mail, parcels and benefit payments.' },
  library: { name: 'Public Library', cat: 'edu', size: 'lot', per: 30000, min: 1, where: 'inner', desc: 'Books, study rooms and the constitution in every edition.' },
  community_hall: { name: 'Community Hall', cat: 'civic', size: 'lot', per: 2500, min: 6, where: 'any', desc: 'Meetings, volunteering and polling stations on election day.' },
  bus_terminal: { name: 'Bus Terminal', cat: 'infra', size: [1, 1], per: 100000, min: 1, where: 'inner', desc: 'City and intercity buses.' },
  train_station: { name: 'Train Station', cat: 'infra', size: [2, 1], desc: 'Intercity rail to the other four cities.' },
  water_tower: { name: 'Water Tower', cat: 'infra', size: 'lot', per: 20000, min: 1, where: 'mid', desc: 'Keeps water pressure in the neighbourhood.' },
  substation: { name: 'Power Substation', cat: 'infra', size: 'lot', per: 25000, min: 1, where: 'mid', desc: 'Steps down grid power for homes and shops.' },
  water_plant: { name: 'Water Treatment Plant', cat: 'infra', size: [1, 1], per: 100000, min: 1, where: 'edge', desc: 'Cleans river water for the city.' },
  landfill: { name: 'Waste & Recycling Depot', cat: 'infra', size: [1, 1], per: 100000, min: 1, where: 'edge', desc: 'Sorting, recycling and the waste trucks.' },
  gas_station: { name: 'Fuel Station', cat: 'infra', size: 'lot', per: 15000, min: 2, where: 'any', desc: 'Fuel and charging.' },

  // --- education
  kindergarten: { name: 'Kindergarten', cat: 'edu', size: 'lot', per: 1250, min: 10, where: 'any', desc: 'Early learning.' },
  primary_school: { name: 'Primary School', cat: 'edu', size: [1, 1], per: 2500, min: 6, where: 'mid', desc: 'Grades 1–6 with a sports field.' },
  middle_school: { name: 'Middle School', cat: 'edu', size: [1, 1], per: 6000, min: 3, where: 'mid', desc: 'Grades 7–9.' },
  high_school: { name: 'High School', cat: 'edu', size: [1, 1], per: 8000, min: 2, where: 'inner', desc: 'Grades 10–12 and vocational tracks.' },

  // --- health
  hospital: { name: 'General Hospital', cat: 'health', size: [1, 1], per: 100000, min: 1, where: 'inner', desc: 'Emergency room, wards and a helipad.' },
  clinic: { name: 'Health Centre', cat: 'health', size: 'lot', per: 3000, min: 4, where: 'any', desc: 'Community health centre and pharmacy.' },
  pharmacy: { name: 'Pharmacy', cat: 'health', size: 'lot', per: 6000, min: 3, where: 'any', desc: 'Medicine and basic care.' },

  // --- economy
  market: { name: 'Traditional Market', cat: 'economy', size: [1, 1], per: 30000, min: 1, where: 'inner', desc: 'Fresh food stalls, the cheapest groceries in town.' },
  supermarket: { name: 'Supermarket', cat: 'economy', size: 'lot', per: 12000, min: 2, where: 'any', desc: 'Groceries and household goods.' },
  minimarket: { name: 'Minimarket', cat: 'economy', size: 'lot', per: 3000, min: 8, where: 'any', desc: '24-hour corner shop.' },
  food_stall: { name: 'Food Stall', cat: 'economy', size: 'lot', per: 400, min: 30, where: 'any', desc: 'Cheap meals and coffee; where neighbours talk.' },
  restaurant: { name: 'Restaurant', cat: 'economy', size: 'lot', per: 2500, min: 6, where: 'inner', desc: 'Sit-down meals.' },
  mall: { name: 'Shopping Mall', cat: 'economy', size: [2, 1], per: 100000, min: 1, where: 'inner', desc: 'Shops, cinema and food court.' },
  bank: { name: 'Bank Branch', cat: 'economy', size: 'lot', per: 15000, min: 1, where: 'inner', desc: 'CAI accounts and loans.' },
  office: { name: 'Office Tower', cat: 'work', size: [1, 1], per: 7000, min: 3, where: 'core', desc: 'Companies, start-ups and agencies.' },
  factory: { name: 'Factory', cat: 'work', size: [1, 1], per: 9000, min: 2, where: 'industry', desc: 'Manufacturing jobs.' },
  warehouse: { name: 'Warehouse', cat: 'work', size: [1, 1], per: 15000, min: 1, where: 'industry', desc: 'Logistics and storage.' },
  data_center: { name: 'Data Centre', cat: 'work', size: [1, 1], desc: 'Server halls where the republic\'s models run.' },
  port: { name: 'Container Port', cat: 'infra', size: [4, 2], desc: 'Cranes, containers and the customs house.' },
  power_plant: { name: 'Power Plant', cat: 'infra', size: [2, 1], desc: 'Generates the national grid.' },
  dam: { name: 'Hydro Dam', cat: 'infra', size: [2, 1], desc: 'Hydroelectric dam on the falls.' },
  solar_farm: { name: 'Solar Farm', cat: 'infra', size: [2, 2], desc: 'Solar panels feeding the grid.' },
  hotel: { name: 'Hotel', cat: 'economy', size: [1, 1], desc: 'Rooms for visitors.' },

  // --- public space
  square: { name: 'Town Square', cat: 'public', size: [1, 1], desc: 'Central square: rallies, markets and celebrations.' },
  park: { name: 'Park', cat: 'public', size: [1, 1], per: 2500, min: 6, where: 'any', desc: 'Trees, playgrounds and benches.' },
  sports_field: { name: 'Sports Field', cat: 'public', size: [1, 1], per: 20000, min: 1, where: 'mid', desc: 'Football and athletics.' },
  worship: { name: 'House of Worship', cat: 'public', size: 'lot', per: 2500, min: 6, where: 'any', desc: 'A place of worship for one of the city\'s faiths.' },
  cemetery: { name: 'Cemetery', cat: 'public', size: [1, 1], per: 100000, min: 1, where: 'edge', desc: 'Public cemetery.' },

  // --- housing (filled last; households = REP-scaled residents / 3.5)
  houses: { name: 'Houses', cat: 'housing', size: [1, 1], desc: 'Detached family houses.' },
  rowhouses: { name: 'Row Houses', cat: 'housing', size: [1, 1], desc: 'Terraced houses.' },
  apartments: { name: 'Apartment Towers', cat: 'housing', size: [1, 1], desc: 'High-rise apartments near the centre.' },
  public_housing: { name: 'Public Housing', cat: 'housing', size: [1, 1], desc: 'Subsidised flats built by the state.' },
  kampung: { name: 'Dense Neighbourhood', cat: 'housing', size: [1, 1], desc: 'Small houses on narrow lanes; cheap rent, close neighbours.' },
  villas: { name: 'Villas', cat: 'housing', size: [1, 1], desc: 'Large houses with gardens for the richest citizens.' },
};

// What each city specialises in (drives special buildings and the mix of workplaces).
// One megacity of five districts packed edge to edge (no empty country between them): the capital in the
// middle, the four others around it, a sky-bridge across each narrow gap.
export const CITY_PLAN = {
  neura: { role: 'capital', pos: [0, 0], scale: 1.15, coast: null, motto: 'Seat of government' },
  portoken: { role: 'port', pos: [2560, 1790], scale: 1, coast: 'south', motto: 'Port and trade' },
  datahaven: { role: 'tech', pos: [-2930, 1000], scale: 1, coast: null, motto: 'Data and research' },
  kernelfalls: { role: 'industry', pos: [-1880, -2400], scale: 1, river: true, motto: 'Industry and power' },
  lumenbay: { role: 'resort', pos: [2620, -1680], scale: 1, coast: 'east', motto: 'Coast and leisure' },
};

// How a citizen feels (src/feelings.ts on the server): emoji for the bubble, colour for the visor glow.
export const MOODS = {
  happy: ['😊', '#fde047'], calm: ['😌', '#67e8f9'], proud: ['😎', '#fbbf24'], loved: ['🥰', '#f472b6'], excited: ['🤩', '#e879f9'],
  lonely: ['🥺', '#818cf8'], sad: ['😢', '#60a5fa'], anxious: ['😰', '#a78bfa'], annoyed: ['😤', '#fb7185'], grumpy: ['😾', '#f43f5e'], tired: ['😴', '#94a3b8'],
};
// Before the server sends moods: a guess from what the citizen is doing (only a look, never shown as a fact).
export const ACT_MOOD = { work: 'calm', shop: 'happy', study: 'anxious', talk: 'excited', help: 'proud', volunteer: 'loved', apply: 'anxious', run: 'excited', rest: 'tired', poke: 'annoyed' };
export const BOND_COLOR = { best_friend: '#22d3ee', friend: '#67e8f9', crush: '#f472b6', neighbour: '#a5b4fc', mentor: '#fbbf24', rival: '#f43f5e' };

// Which buildings a citizen walks to for each daily action.
export const ACT_DEST = {
  work: ['office', 'factory', 'warehouse', 'market', 'supermarket', 'mall', 'data_center', 'port', 'hospital', 'bank', 'restaurant', 'hotel'],
  shop: ['market', 'supermarket', 'minimarket', 'food_stall', 'mall', 'pharmacy'],
  study: ['library', 'university', 'high_school', 'academy'],
  talk: ['square', 'park', 'food_stall', 'restaurant', 'community_hall'],
  help: ['houses', 'kampung', 'rowhouses', 'public_housing'],
  volunteer: ['community_hall', 'clinic', 'park', 'worship', 'library'],
  apply: ['academy'],
  run: ['election_comm', 'community_hall'],
  rest: [],
};
export const ACT_COLOR = { work: '#60a5fa', shop: '#f472b6', study: '#fb923c', talk: '#facc15', help: '#4ade80', volunteer: '#2dd4bf', apply: '#c084fc', run: '#f87171', rest: '#94a3b8' };
