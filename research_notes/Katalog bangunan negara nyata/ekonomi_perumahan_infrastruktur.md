# Economic, housing and infrastructure buildings of real countries + land-use proportions (for the COUNTRY AI city map)

Scope: building catalogue (economy / housing / infrastructure), counts per population, densities, land-use shares, employment structure. Target use: lay out 5 cities (Neura City capital, Port Token port, Datahaven tech, Kernel Falls, Lumen Bay) for 10,000 AI citizens.

Research note on reliability: the World Bank API calls for employment-by-sector and ATMs timed out, and the Demographia PDF URL returned 404, so some requested numbers are only in Gaps (with unverified approximate values clearly labelled). Everything in "Cited Findings" was seen in a fetched page or search result in this session (12 Nov 2026).

---

## 1. Economy buildings: types, counts per population, size

### Takeaway
Real-world ratios that can be scaled to 10,000 people: Japan has ~1 konbini per ~2,200 people, Indonesia ~1 Indomaret/Alfamart per ~7,000; bank branches range from 3.4 (Nigeria) to 33.7 (Japan) per 100,000 adults; Singapore has ~120 hawker centres with ~6,000 cooked-food stalls (~1 stall per 1,000 residents). For a 10,000-citizen nation that means roughly 2–5 minimarkets, 1–3 bank branches, ~10 cooked-food stalls in 1 hawker centre/pasar, plus one of each national institution (central bank, treasury, exchange, customs) in the capital/port.

### Cited Findings
**Convenience stores / minimarkets**
- Japan: 55,736 convenience stores at end of 2024 (Japan Franchise Association data, via Jiji), +23 vs 2023; all-store sales a record ¥11,795.3 billion in 2024 — [Nippon.com/Jiji](https://nippon.com/en/news/yjj2025012000863); [Tokyo Weekender](https://www.tokyoweekender.com/japan-life/news-and-opinion/japanese-convenience-store-sales-record-high-in-2024/)
- Japan's store count peaked at 55,911 in January 2021, then declined for 23 consecutive months (as of mid-2024) — i.e. saturation at ~55,700–55,900 stores — [Asia Economy](https://view.asiae.co.kr/en/article/2024062616010227595)
- Indonesia: in 2022 Indomaret had 19,996 stores (+4.5% y/y) and Alfamart 17,394 (+8.3%) — [Databoks/Katadata](https://databoks.katadata.co.id/en/trade/statistics/740c77b5d36f70d/the-number-of-indomaret-and-alfamart-outlets-continues-to-grow-until-2022)
- Indonesia 2024: Indomaret "more than 23,000 outlets"; Alfamart planned to close ~400 stores in 2024 (rent, franchise strategy); Indomaret overtook Alfamart in outlet count and growth in Q1 2025 — [Databoks Q1 2025](https://databoks.katadata.co.id/en/trade/statistics/681dbd477e59e/indomaret-leads-minimarket-outlet-growth-in-q1-2025); [KrASIA](https://kr-asia.com/indonesian-minimart-king-alfamart-boosts-quick-commerce-to-reverse-slowdown); [GlobeNewswire industry report 2025](https://www.globenewswire.com/news-release/2025/03/31/3052490/28124/en/Indonesia-Convenience-Retailers-Industry-Report-2025-Indomaret-and-Alfamart-Drive-Outlet-Growth-with-Expansion-Beyond-Java.html)

**Hawker centres / food stalls (Singapore)**
- As of 31 Mar 2024 NEA managed 119 hawker centres with >14,000 hawker stalls (includes market produce stalls) — [MSE written reply](https://www.mse.gov.sg/latest-news/written-reply-to-pq-on-evaluation-of-stall-tender-bids/)
- Mid-2024: 120 hawker centres housing ~6,000 cooked-food stalls (2023 occupancy 97%) plus 776 coffee shops (HDB) — [Malay Mail long read, 22 Jul 2024](https://www.malaymail.com/news/singapore/2024/07/22/the-long-read-singaporeans-want-cheap-and-good-hawker-food-hawkers-need-to-make-money-how-do-we-square-the-circle/144527)
- 13 of these are "social enterprise hawker centres" run by NEA-appointed operators — [Leader of the Opposition SG data, May 2024](https://leaderoftheopposition.sg/2024/05/08/data-on-nea-operated-hawker-centres-tenanted-to-fb-chains-and-to-independent-operators)
- Official list/dataset of government markets & hawker centres — [NEA list Aug 2026](https://www.nea.gov.sg/docs/default-source/hawker-centres-documents/list-of-hcs_-17-august-2026.pdf); [data.gov.sg](https://data.gov.sg/dataset/list-of-government-markets-hawker-centres)

**Commercial bank branches per 100,000 adults (IMF Financial Access Survey, via World Bank FB.CBK.BRCH.P5, 2023)** — [World Bank API, fetched](https://api.worldbank.org/v2/country/IDN;USA;JPN;SGP;DEU;GBR;KOR;BRA;NGA;IND/indicator/FB.CBK.BRCH.P5?format=json&date=2021:2023&per_page=100&source=2); indicator definition — [FRED/IMF FAS](https://fred.stlouisfed.org/data/SGPFCBODCANUM.txt)

| Country | 2021 | 2022 | 2023 |
|---|---|---|---|
| Japan | 33.80 | 33.75 | 33.74 |
| United States | 28.21 | 27.11 | 26.46 |
| Brazil | 17.55 | 16.91 | 16.39 |
| India | 14.39 | 14.27 | 14.41 |
| South Korea | 13.57 | 12.89 | 12.70 |
| Indonesia | 15.77 | 12.23 | 11.55 |
| Germany | 7.60 | 7.02 | 6.66 |
| Singapore | 6.95 | 6.43 | 6.09 |
| Nigeria | 4.08 | 3.51 | 3.43 |
| United Kingdom | null | null | null |

- Trend: branch numbers falling in almost every country 2021→2023 (Indonesia −27%, US −6%, Germany −12%) as banking goes digital — same source.

### Inferences
- Konbini ratio: 55,736 stores ÷ Japan's ~124 million people ≈ 1 store per ~2,200 people (population figure is an assumption, not fetched) → 10,000 citizens ≈ 4–5 konbini. Indonesia: (~23,000 Indomaret + ~17,000 Alfamart) ÷ ~280 million ≈ 1 per ~7,000 → 1–2 minimarkets. Suggested COUNTRY AI value: 1 minimarket per ~2,500–3,000 citizens (≈ 4 total; Neura City 2, others 0–1 each, or 1 per city).
- Hawker ratio: 6,000 cooked-food stalls ÷ Singapore's ~6 million residents ≈ 1 stall per 1,000 people; ~120 centres ≈ 1 centre per ~50,000 people. For 10,000 citizens: ~10 cooked-food stalls, best grouped into 1 hawker centre / pasar in the capital plus warung scattered in other cities (Indonesian warung density is much higher, but I found no reliable number — see Gaps).
- Bank branches: 8,000 adults (assume ~80% adults) × 11.6/100k (Indonesia) ≈ 0.9 branch; × 33.7/100k (Japan) ≈ 2.7. Suggested: 1 central bank HQ (capital) + 2–3 commercial bank branches (Neura City, Port Token, Datahaven) + ATMs at minimarkets.
- National one-off institutions (count = 1 regardless of population): Central bank (Neura City), Ministry of Finance / Treasury + tax office (Neura City), stock/token exchange (Neura City or Datahaven), customs house (Port Token, also at any border gate — relevant to the smuggling underworld), port authority (Port Token).
- Proposed relative footprint (grid cells, 1 cell ≈ one small shop lot) — design judgement, not sourced: warung/stall 1; minimarket 1–2; pasar/hawker centre 6–10; supermarket 4–6; bank branch 2; mall 16–30; office tower 4 (tall); central bank/treasury 6–9; exchange 4–6; warehouse 6–12; factory 9–20; port 40+; airport (optional) 100+.

### Gaps
- No fetched figure for supermarkets, malls, restaurants, warung or traditional pasar per population (Indonesia BPS publishes "Statistik Pasar" counts; not retrieved). Unverified training-knowledge order of magnitude: Indonesia has roughly 16,000 traditional markets (≈1 per ~17,000 people) — verify with BPS.
- ATMs per 100,000 adults (FB.ATM.TOTL.P5) — World Bank API timed out; not retrieved.
- Office floor space per worker, CBD shares, factory/warehouse sizes, port/airport throughput per population — not researched due to tool budget.
- Stock exchange: no "per population" ratio exists; every country has 1–2 national exchanges (general knowledge, not cited).

---

## 2. Housing: types, shares, household size, densities

### Takeaway
Public housing dominates in Singapore (76.4% of residents in HDB flats, FY2023); slum shares range from ~0% (Singapore, Germany) to ~48.5% of urban population (Nigeria, 2022), with Indonesia ~19.4% and Brazil ~14.9%. Household sizes span ~2.0–2.3 (Germany, Japan, UK, Korea) to ~4.6–4.9 (India, Nigeria). Planning guidance: detached houses ≲20 dwellings/ha, mixed terraced/semis ~35–50 dwellings/ha, flats much higher.

### Cited Findings
**Public housing**
- Singapore: share of resident population living in HDB flats = 76.4% (FY2023), down from 76.8% (FY2022); in HDB *sold* flats 73.4% (from 73.7%) — [HDB Key Statistics FY23](https://www.hdb.gov.sg/cs/infoweb/-/media/HDBContent/Images/SCEG/HDB-KS-FY23.ashx). Earlier ~77% in FY2021/22 — [HDB Key Statistics FY21](https://assets.hdb.gov.sg/about-us/news-and-publications/annual-report/2022/ebooks/Key%20Statistics%20FY21.pdf). Note: the commonly quoted "~78–80%" is an older figure; the share is slowly declining.
- Senior households now form about a third of HDB residents (up from a quarter in 2018) — [cos.sg](https://cos.sg/senior-households-form-a-third-of-hdb-residents-up-from-one-quarter-in-2018/)

**Slums / informal settlements — population living in slums, % of urban population (World Bank EN.POP.SLUM.UR.ZS, UN-Habitat based)** — [World Bank API, fetched](https://api.worldbank.org/v2/country/IDN;USA;JPN;SGP;DEU;GBR;KOR;BRA;NGA;IND/indicator/EN.POP.SLUM.UR.ZS?format=json&date=2018:2022&per_page=100&source=2)

| Country | 2018 | 2020 | 2022 |
|---|---|---|---|
| Nigeria | 51.5 | 49.0 | 48.5 |
| Indonesia | 20.2 | 19.4 | 19.4 |
| Brazil | – | – | 14.9 |
| South Korea | 6.8 | 5.6 | 4.5 |
| India | 5.41 (2018/2019) | – | – |
| Japan | – | – | 2.0 |
| United Kingdom | 0.1 | 0.1 | 0.16 |
| United States | 0.15 | 0.15 | 0.09 |
| Germany | 0 | 0 | 0 |
| Singapore | 0 | 0 | 0 |

- CONFLICT for India: the WB series shows 5.41% (2019, appears to be a national-definition value), while other compilations give ~41.5% (2022) or 49% (2020) — [Statista chart](https://www.statista.com/chart/35252/share-of-urban-population-living-in-slums); [IndexMundi ranking](https://www.indexmundi.com/facts/indicators/EN.POP.SLUM.UR.ZS/rankings). Treat India as "~40–50% under UN-Habitat's household-deprivation definition; ~5% under India's census 'notified slum' definition".
- Globally ~23% of urban residents lived in slums in 2022; ~50% in sub-Saharan Africa and South Asia — [Statista chart (World Habitat Day)](https://www.statista.com/chart/35252/share-of-urban-population-living-in-slums); SDG 11 context — [UN SDG Report 2023, Goal 11](https://unstats.un.org/sdgs/report/2023/Goal-11)

**Average household size (persons per household)** — [Wikipedia list (mostly UN-sourced, mixed years)](https://en.wikipedia.org/wiki/List_of_countries_by_number_of_households); primary dataset = [UN DESA Household Size & Composition 2022](https://population.un.org/Household/index.html)

| Country | Persons/household | Year |
|---|---|---|
| Nigeria | 4.90 | 2015 |
| India | 4.57 | 2015 |
| Indonesia | 3.86 | 2017 |
| Brazil | 3.31 | 2010 |
| Singapore | 3.29 | 2010 |
| United States | 2.49 | 2020 |
| United Kingdom | 2.27 | 2011 |
| Japan | 2.26 | 2020 |
| South Korea | 2.18 | 2022 (Ministry of Interior resident registration) |
| Germany | 2.05 | 2011 |

- Smallest averages are in East Asia and Europe (Denmark ~1.8) — [UN DESA household size page](https://www.un.org/development/desa/pd/node/3587)

**Dwelling densities by housing type (UK planning guidance)**
- Detached and semi-detached houses suit densities below ~20 dwellings per hectare (8/acre) — [Essex Design Guide](https://www.essexdesignguide.co.uk/design-details/layout-details/criteria-for-placing-buildings-at-densities-over-20-dwellings-per-hectare/); separate criteria for >50 dph types — [Essex Design Guide >50 dph](https://www.essexdesignguide.co.uk/design-details/layout-details/criteria-for-development-types-over-50-dwellings-per-hectare/)
- 35 dph on one parcel can be achieved by 70 flats, or 30 terraced + 22 semi/detached, or 40 terraced + 30 semi/detached (layout illustration) — [Cotswold DC appendix](https://meetings.cotswold.gov.uk/Data/Council/201709261300/Agenda/2bl4cvV7yCaxgSl2f5fA01UiRkWy.pdf)
- ~50 dph (≈250 habitable rooms/ha) achievable with a mix of terraced, semi-detached and detached houses with gardens — [GLA SRQ III large sites](https://www.london.gov.uk/sites/default/files/srq_iii_exploring_the_housing_potential_of_large_sites.pdf)
- Density bands: low 12.5–20 dph, medium 20–40 dph, high ≥40 dph — [Landcom Density Guide Book (NSW)](https://landcom.nsw.gov.au/assets/Landcom-design-guidelines-and-fact-sheets-2008-2011/Density-Guide-Book.pdf) (seen via search snippet; source reliability moderate)

### Inferences
- Dwellings needed: 10,000 citizens ÷ household size. AI citizens are individuals, so a design choice is needed: at 1 agent = 1 household → 10,000 units; at an Indonesian-style 3.9 → ~2,600 units; at a Japan/Korea-style ~2.2 → ~4,500 units. A sensible compromise is ~2.5 persons/unit → ~4,000 units.
- Persons per hectare (net) = dph × household size. With 2.5 persons/unit: detached (~15 dph) ≈ 40 p/ha; terraced/row (~40–50 dph) ≈ 100–125 p/ha; mid-rise flats (~100–150 dph, unverified) ≈ 250–375 p/ha; HDB-type high-rise (~200+ dph, unverified) ≈ 500+ p/ha.
- Suggested tenure mix for COUNTRY AI (design, blending cited shares): public housing blocks (HDB/rusun/danchi style) 55–70%; private row houses/apartments 20–30%; elite gated estate 2–5% (near Neura City / Lumen Bay); informal settlement 0–10% (Port Token edge, linked to the underworld: Indonesia-like 19% would be the realistic emerging-economy value, Singapore-like 0% the "model state"); dormitories/asrama for police and military (≈ 45 officers + 20 soldiers in the 100-seat government) as compounds in Neura City/Port Token; student/worker dormitories near Datahaven.
- Tie to economy: UBI and wages determine which housing tier a citizen can afford — slum share can be a live indicator of the simulation's poverty, reported like the World Bank's EN.POP.SLUM.UR.ZS.

### Gaps
- No fetched persons-per-hectare numbers for HDB estates, Japanese danchi, Indonesian rusun, UK council estates or Brazil's Minha Casa Minha Vida; no fetched share of housing stock for UK social housing (training-knowledge, unverified: ~16–17% of English households in social rent), Japan public housing (~5%), Brazil MCMV (several million units since 2009). Verify via English Housing Survey, MLIT, Caixa/Ministério das Cidades.
- Police/military housing (asrama/kompleks) sizes: not researched.
- Household-size figures are mixed years (2010–2022) from a secondary list; use UN DESA 2022 database for consistency.

---

## 3. Infrastructure

### Takeaway
Within the tool budget I did not retrieve sourced per-capita ratios for power plants, substations, water treatment, sewage, landfills, telecom towers or data centres. The only fetched infrastructure-planning standard is UN-Habitat's street-network rule (≥30% of land, ≥18 km of streets per km²). Everything else below is a design proposal or a gap.

### Cited Findings
- Street network: UN-Habitat's first principle of sustainable neighbourhood planning = streets occupy at least 30% of land and at least 18 km of street length per km² — [UN-Habitat, Five principles of neighbourhood design](https://unhabitat.org/five-principles-of-neighbourhood-design); [UN-Habitat PDF, A New Strategy of Sustainable Neighbourhood Planning](https://unhabitat.org/sites/default/files/download-manager-files/A%20New%20Strategy%20of%20Sustainable%20Neighbourhood%20Planning%20Five%20principles.pdf)
- UN-Habitat leadership has cited 30–35% street area plus 15–20% open space (≈50% public space) as the minimum to avoid congestion — [Next City](https://nextcity.org/urbanist-news/how-much-public-space-does-a-city-need-UN-Habitat-joan-clos-50-percent); [Habitat III Issue Paper 11](https://habitat3.org/wp-content/uploads/11-Habitat-III-Issue-Paper-11_Espaces-publiques.pdf)
- NYC (1995 data): streets ≈22.4% of total land area — [Demographia NYC land use](https://demographia.com/db-nyc-landuse.htm)

### Inferences (design proposal, unsourced ratios flagged)
- Road hierarchy for each city: 1 arterial/ring road (capital gets a ring), collectors every ~400–800 m, local streets forming blocks of ~100 m (consistent with 18 km/km² ⇒ average block spacing ~110 m on a grid: a square grid with spacing s has 2/s km of street per km², 2/0.11 ≈ 18).
- Inter-city links: rail line or highway connecting the 5 cities; bridge(s) at Port Token / Lumen Bay waterfronts.
- Utilities (one per city unless noted): substation per city; 1–2 power plants nationally (e.g. gas/solar at Kernel Falls — "Falls" suggests hydro); water treatment plant + reservoir (Kernel Falls); sewage treatment per city or shared; landfill/incinerator outside Port Token; telecom towers spread ~1 per few km² (unverified); data centres concentrated in Datahaven (fits the "tech city" and the LLM-brain lore).
- Transport: port + customs (Port Token), central train station (Neura City), bus terminal per city; airport optional (needs a large footprint, likely > a whole small city in tile terms).

### Gaps
- Per-capita electricity, water (litres/person/day), waste (kg/person/day), substation service radius, telecom tower density, data-centre counts by country — not retrieved. Suggested sources: IEA, World Bank WDI (EG.USE.ELEC.KH.PC), OECD Environment, national utility regulators.
- Bridges/ring-road standards: not researched.

---

## 4. Land-use proportions and gross densities of real cities

### Takeaway
A defensible template: streets ~30%, green open space ~20–30% (Indonesian law: ≥30% RTH, 20% public + 10% private), residential ~35–40%, commercial/mixed ~5–10%, industrial ~3–7%, public/institutional ~5–10%. UN-Habitat's target gross density is ≥15,000 people/km² (150/ha); real built-up areas average ~4,200/km² globally, Jakarta ~9,800/km² and Tokyo-Yokohama ~4,600/km² (Demographia 2020).

### Cited Findings
**Regulatory / normative**
- Indonesia UU 26/2007 (Penataan Ruang) art. 29: green open space (RTH) ≥30% of city area, of which ≥20% public RTH and 10% private RTH — [Leks&Co explainer](https://blog.lekslawyer.com/indonesia-spatial-planning-green-open-space-requirement/); [UU 26/2007 full text, JDIH Kemenkeu](https://jdih.kemenkeu.go.id/api/download/fullText/2007/26TAHUN2007UU.htm)
- Permen ATR/BPN 14/2022 (Penyediaan dan Pemanfaatan RTH) is the technical rule; it acknowledges local governments struggle to reach 20% public RTH and allows integrating non-green open space (RTNH) and blue open space (RTB) toward the target — [Permen ATR/BPN 14/2022 PDF](https://www.dispupr.baritoutarakab.go.id/assets/data/Permen%20ATRBPN%2014%20Tahun%202022%20tentang%20Penyediaan%20dan%20Pemanfaatan%20Ruang%20Terbuka%20Hijau.pdf); [BPK database entry](https://peraturan.bpk.go.id/Details/255207)
- No specific enforcement mechanism against local governments that miss the 30% target — [hukumproperti.com](https://hukumproperti.com/undang-undang-penataan-ruang-dan-ruang-terbuka-hijau-di-indonesia/)
- UN-Habitat five principles: (1) ≥30% land for streets, ≥18 km street/km²; (2) high density ≥15,000 people/km² (=150 p/ha, 61 p/acre); (3) mixed land use, ≥40% of floor space for economic use — [UN-Habitat five principles page](https://unhabitat.org/five-principles-of-neighbourhood-design); [UN-Habitat PDF](https://unhabitat.org/sites/default/files/download-manager-files/A%20New%20Strategy%20of%20Sustainable%20Neighbourhood%20Planning%20Five%20principles.pdf). (Principles 4 "social mix" and 5 "limited land-use specialization" are in the same document; their exact thresholds — commonly cited as 20–50% low-cost housing and single-function blocks <10% of a neighbourhood — were not re-verified in this session.)

**Observed land use — New York City (tax-lot area, excludes streets)** — [NYC Planning, NYC profile](https://www.nyc.gov/assets/planning/download/pdf/community/community-portal/profile/nyc_profile.pdf) (column headers inferred from snippet)
- 1–2 family residential 27.0%; multi-family residential 12.3%; mixed residential/commercial 3.0%; commercial/office 4.1%; industrial 3.5%; open space/recreation 26.9% (remainder: transport/utility, public facilities, parking, vacant).
- Older (1995) whole-area breakdown including streets: streets 22.4%, open space 16.1%, 1–2 family homes 22.9%, industrial 7.0% — [Demographia NYC land use](https://demographia.com/db-nyc-landuse.htm)

**Gross densities (built-up urban areas)**
- Demographia World Urban Areas 2020: Jakarta 9,800/km² (25,300/mi²), more than double Tokyo-Yokohama 4,600/km² (12,000/mi²) — [NewGeography, Demographia 2020](https://www.newgeography.com/content/006693-demographia-world-urban-areas-2020-tokyo-lead-diminishing)
- Demographia 2023 world average built-up density ≈4,231/km² — [Meeting of the Minds summary](https://meetingoftheminds.org/a-comparison-of-the-worlds-1000-largest-urban-areas-30879)
- Demographia 2025 (20th edition) changed its urban-area definition (Jakarta drops to #4), so densities across editions are not directly comparable — [Demographia World Urban 2025 (link 404 at fetch time)](https://blogs.chapman.edu/wp-content/uploads/sites/56/2025/06/Demographia-World-Urban-2025.pdf); UN WUP 2025 now ranks Jakarta the world's most populous city (~42 million, different definition) — [UN DESA Voice, Dec 2025](https://desapublications.un.org/un-desa-voice/feature/december-2025/latest-urbanization-data-reveal-worlds-most-populous-cities)
- Gulshan (Dhaka) identified as the world's densest urban area over 500,000 population (2019) — [NewGeography](https://mail.newgeography.com/content/007939-jakarta-closing-population-gap-with-tokyo)

### Inferences
- Area budget for 10,000 citizens: at UN-Habitat's 15,000/km² the whole nation's urban fabric is ~0.67 km² (67 ha); at Jakarta-like 9,800/km² ≈ 1.0 km²; at world-average 4,231/km² ≈ 2.4 km². If citizens split ~3,000 (capital) / 2,000 / 2,000 / 1,500 / 1,500, the capital at 15,000/km² needs ~20 ha and each smaller city ~10–13 ha.
- Recommended COUNTRY AI land-use template per city (gross area), reconciling UN-Habitat and UU 26/2007:
  - Streets/transport 30% (UN-Habitat minimum)
  - Green open space (RTH) 20% public + housing-plot gardens counted as the 10% private (UU 26/2007)
  - Residential ~30–35% (NYC: ~39% of lot area is residential)
  - Commercial / mixed-use / offices ~6–10% (higher in Neura City CBD; NYC 4.1% + 3% mixed)
  - Public/institutional (government, court, police, schools, hospital, academy) ~5–8%
  - Industrial / logistics ~3–7% (NYC 3.5%; Port Token and Kernel Falls higher, Lumen Bay lower)
  - Water bodies: city-specific (Port Token, Lumen Bay coastline; Kernel Falls river) — Permen ATR/BPN 14/2022 allows blue space toward open-space targets.
- City specialisation: Neura City = CBD, central bank, treasury, exchange, parliament; Port Token = port, customs, warehouses, informal settlement/smuggling quarter; Datahaven = data centres, offices, dorms; Kernel Falls = power/water/industry; Lumen Bay = waterfront leisure, elite estate, tourism/restaurants.

### Gaps
- Not fetched (training-knowledge, UNVERIFIED approximate city-proper densities, people/km²): Seoul ~15,500–16,000; DKI Jakarta ~16,000 (BPS); Mumbai (Greater Mumbai) ~20,000+; New York City ~11,000; Singapore (whole country) ~8,000 (SingStat); São Paulo city ~7,500–8,000; Tokyo Metropolis ~6,400; London (Greater London) ~5,600; Berlin ~4,100–4,200; Lagos — strongly definition-dependent. Verify with national statistics offices or Demographia 2024/2025 tables.
- Singapore (URA Master Plan / Land Use Plan) and Tokyo land-use percentages — not retrieved.

---

## 5. Employment structure (to size workplaces)

### Takeaway
Globally ~50% of jobs are in services, ~26% agriculture, ~24% industry (2021–2022); agriculture ranges from ~5% in Europe to ~48% in Africa. Country-specific 2023 shares could not be fetched (World Bank API timeouts), so the per-country table below is unverified.

### Cited Findings
- Global 2022: services ≈50% of employment, agriculture ≈26%, industry ≈24% (WDI via secondary summary) — [Statista](https://statista.com/statistics/1339213/global-employment-figures-sector)
- Global agricultural employment share fell from 39.8% (2000) to 26.4% (2021) — [FAO Statistical Yearbook](https://www.fao.org/3/cc6627en/cc6627en.pdf)
- 2022 agriculture share of employment: highest in Africa (48%), lowest in Europe (5%) — [FAO](https://openknowledge.fao.org/server/api/core/bitstreams/7b3af461-0c04-4465-8306-34f765c3a263/content)
- Sub-Saharan Africa 2022: >50% of workers in agriculture, ~37% in services — [ILOSTAT blog](https://ilostat.ilo.org/blog/africas-changing-employment-landscape)
- Country data series (ILO modelled estimates) — [OWID agriculture share](https://ourworldindata.org/grapher/share-of-employment-in-agriculture); [OWID industry share](https://ourworldindata.org/grapher/industry-share-of-total-emplyoment)

### Inferences
- For a 10,000-citizen AI nation with a working-age share of ~65% → ~6,500 workers: a "developed services" profile (≈75% services / 22% industry / 3% agriculture) gives ~4,900 service jobs, ~1,400 industrial, ~200 farm/fishing; an "Indonesia-like" profile (≈50/22/28, unverified) gives ~3,250 / ~1,430 / ~1,820. Since the sim currently has abstract "work" with no sectors, the developed profile fits a city-state better (Singapore-like), with farms/fishing as a small belt around Kernel Falls/Lumen Bay.
- Workplace counts (design, assuming ~20 workers per shop/office floor, ~200 per factory, ~50 per warehouse — unsourced sizing): services ~4,900 ⇒ e.g. ~10 office towers (300 each) + ~150 shops/stalls + public sector (100 government seats + schools/clinics); industry ~1,400 ⇒ ~5 factories + ~6 warehouses + port/utility staff; agriculture ~200 ⇒ ~10 farms + 1 fishing harbour.

### Gaps
- Per-country 2023 sector shares not retrieved. UNVERIFIED training-knowledge approximations (ILO modelled, ~2022), to be checked against World Bank SL.AGR/SL.IND/SL.SRV.EMPL.ZS:
  - Agriculture: India ~43%, Nigeria ~35%, Indonesia ~29%, Brazil ~8–9%, South Korea ~5%, Japan ~3%, US ~1.7%, Germany ~1.2%, UK ~1%, Singapore <1%.
  - Industry: Germany ~27%, South Korea ~25%, India ~25%, Japan ~24%, Indonesia ~22%, Brazil ~20%, US ~19%, UK ~18%, Singapore ~15%, Nigeria ~12%.
  - Services: Singapore ~84%, UK ~81%, US ~79%, Germany ~72%, Japan ~73%, Brazil ~71%, South Korea ~70%, Nigeria ~52%, Indonesia ~49%, India ~32%.
- Office floor area per worker and factory headcounts — not researched.
