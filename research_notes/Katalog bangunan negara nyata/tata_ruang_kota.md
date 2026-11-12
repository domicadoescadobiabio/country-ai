# Urban spatial layout of real cities and planned capitals (for seeded city-map generation in COUNTRY AI)

Scope note: 18 tool calls (searches + fetches), 12 November 2026. Many figures come from Wikipedia or secondary summaries because official master-plan PDFs were not fetched in full. Where sources conflict, both values are given. Everything under "Inferences" is my own derivation for generation rules, not a sourced fact.

## Classic urban models: where CBD, rich/poor housing and industry go

### Takeaway
The main models give five different starting layouts. Burgess uses rings around a CBD. Hoyt uses wedges along transport routes. Harris-Ullman uses several nuclei. McGee centres the city on the port, and Griffin-Ford has a commercial spine with elite housing along it and squatters at the edge. US models put the poor near the centre and the rich at the edge. Latin American and Southeast Asian models reverse this, putting the elite near the centre and squatters at the edge.

### Cited Findings
- Burgess concentric zone model (1925, Chicago), five rings from the centre: (1) CBD, (2) zone of transition with mixed residential and commercial use, (3) working-class residential (inner suburbs, later the "inner city"), (4) better-quality middle-class homes (outer suburbs), (5) commuter zone of affluent homes on the outskirts. The diagram's key also shows a "factory zone". — [Wikipedia: Concentric zone model](https://en.wikipedia.org/wiki/Concentric_zone_model)
- Criticisms of Burgess: it assumes "an even, unchanging landscape" (no hills or water), it describes a US pattern (poor centre, rich suburbs) that is "the reverse of the norm elsewhere", and it does not fit polycentric cities. — [Wikipedia: Concentric zone model](https://en.wikipedia.org/wiki/Concentric_zone_model)
- Hoyt sector model (Homer Hoyt, 1939) modifies Burgess so that growth spreads outward in sectors (wedges). It is based on early-20th-century rail transport, and terrain can restrict or channel growth along certain wedges. The model fits many British cities. — [Wikipedia: Sector model](https://en.wikipedia.org/wiki/Sector_model)
- The Wikipedia sector-model page does not describe which wedge is high-, middle- or low-class housing or where industry sits. The standard textbook version (high class along the best transport or amenity axis, low class next to the industry/rail wedge) is not covered by a source fetched here. — [Wikipedia: Sector model](https://en.wikipedia.org/wiki/Sector_model)
- The multiple nuclei model (Harris and Ullman, 1945) is listed as one of the models influenced by Burgess. Its detailed contents were not retrieved. — [Wikipedia: Concentric zone model](https://en.wikipedia.org/wiki/Concentric_zone_model)
- McGee Southeast Asian city model (T. G. McGee, 1967, *The Southeast Asian City*): the focal point is the old colonial port zone, not a CBD. Mixed commercial, residential and squatter zones form outward from the port. Commercial functions are spread over several smaller nodes (polycentric), and a mixed-land-use zone holds informal businesses. — [TutorChase AP HG 6.5.7](https://www.tutorchase.com/notes/ap/human-geography/6-5-7-urban-models-in-southeast-asia); [Fiveable: McGee model](https://fiveable.me/ap-hug/key-terms/mcgee-model); [Univ. Nantes catalogue record](https://theses.univ-nantes.fr/vufind/Record/PPN015803198)
- Griffin-Ford Latin American city model (1980) combines radial sectors with concentric zones. High-class residential zones extend from the centre, middle-class zones lie in the inner city, and low-income squatter settlements sit on the periphery. — [TutorChase AP HG 6.5.6](https://www.tutorchase.com/notes/ap/human-geography/6-5-6-urban-models-from-latin-america-southeast-asia-and-africa)
- The specific labels "alien commercial zone" (McGee) and "spine / zone of disamenity" (Griffin-Ford) did not appear in the results fetched, so they are unverified here. — [TutorChase AP HG 6.5.6](https://www.tutorchase.com/notes/ap/human-geography/6-5-6-urban-models-from-latin-america-southeast-asia-and-africa)

### Inferences
- Generation rule: choose a model per city archetype. Capital = planned axis core plus Hoyt wedges (elite wedge along the ceremonial axis). Port city = McGee (port as the nucleus, polycentric markets, mixed zone, informal edge). Tech city = multiple nuclei (CBD, research campus and residential nuclei separated by parks). Old/organic towns = Burgess rings around a traditional square.
- Wealth gradient as a parameter: `wealthByDistance` positive (US/Burgess, rich at the edge) or negative (Latin American/SE Asian, rich near the centre or along the spine). For a Southeast Asian-flavoured nation, the negative gradient plus a peripheral informal ring is the more believable choice.
- Industry: put it in a wedge that follows the rail or port line, adjacent to the low-income wedge and away from the elite wedge. The textbook basis for this is the Hoyt model, but that specific claim is not sourced here.

### Gaps
- Original Hoyt (1939) and Harris-Ullman (1945) texts, and the full Griffin-Ford and McGee diagrams with all zone names, were not retrieved.
- There is no sourced statement on industry placed "downwind". It is a common planning heuristic but unverified here.

## Planned capitals: axes, government cores, distances

### Takeaway
Planned capitals almost always use one dominant ceremonial axis or boulevard, 1.6–16 km long, with the head of state or parliament at one end (often on a hill or promontory). Ministries line the axis, and the three branches (executive, legislature, court) are clustered in a single "triangle / three powers / three arms" core of roughly 1–2 km. Housing follows in repeated modules (superquadras, sectors, precincts), and industry, airport and military sit outside the core.

### Cited Findings
**Washington DC (L'Enfant Plan, 1791)**
- The Congress House (Capitol) sits on Jenkins Hill ("a pedestal awaiting a monument"). The President's House sits on a ridge parallel to the Potomac. Pennsylvania Avenue forms the hypotenuse of a right triangle connecting the two. — [Wikipedia: L'Enfant Plan](https://en.wikipedia.org/wiki/L%27Enfant_Plan)
- The Mall is a 400 ft (122 m) wide "grand avenue", about 1 mile (1.6 km) long, running east–west from the Congress House. — [Wikipedia: L'Enfant Plan](https://en.wikipedia.org/wiki/L%27Enfant_Plan)
- Broader diagonal grand avenues are laid over an orthogonal street grid and meet it at circles and rectangular plazas. The avenue east of the Capitol is 160 ft (49 m) wide and a mile long. Fifteen squares were allocated to the 15 states and were meant to be visible from one another. — [Wikipedia: L'Enfant Plan](https://en.wikipedia.org/wiki/L%27Enfant_Plan)
- The often-quoted Capitol–White House distance (~2.4 km) was not confirmed by the page fetched.

**Canberra (Griffin plan, 1912–13)**
- The land axis runs from Mount Ainslie through Capital Hill and Red Hill towards Mount Bimberi, about 50 km away. The water axis crosses it at a right angle along Lake Burley Griffin towards Black Mountain. The two axes meet near the centre of the National (Parliamentary) Triangle. — [Wikipedia: Parliamentary Triangle](https://en.wikipedia.org/wiki/Parliamentary_Triangle,_Canberra); [NCA Parliament House Vista HMP](https://www.nca.gov.au/sites/default/files/Parliament%20House%20Vista%20Heritage_Management_Plan_Volume_2_0.pdf)
- The triangle is bounded by Commonwealth, Kings and Constitution Avenues. Sources differ: some give only Kings and Commonwealth Avenues for the Parliamentary Zone. The lake was completed in 1963 or 1964, depending on the source. — [Wikipedia: Parliamentary Triangle](https://en.wikipedia.org/wiki/Parliamentary_Triangle,_Canberra); [NCA Amendment 33](https://nca.gov.au/sites/default/files/amendments/Amendment%2033%20-%20Parliamentary%20Zone%20Review.pdf)

**Brasília (Lúcio Costa Pilot Plan, 1957)**
- The Monumental Axis is about 16 km long, from the Rodoferroviária station to Three Powers Plaza. Its first section is the Esplanade of the Ministries, named for the ministry buildings that line it. — [Wikipedia: Monumental Axis](https://en.wikipedia.org/wiki/Monumental_Axis)
- The Esplanade was later enlarged beyond Costa's original dimension, but no figure was found. — [docomomo journal](https://docomomojournal.com/index.php/journal/article/download/74/393)
- Superquadras measure 280 × 280 m, with about eleven six-storey buildings on pilotis, and the original design had 96 superquadras. These figures come from a lower-authority guide and need checking against IPHAN. — [visiearth guide](https://visiearth.pages.dev/br/the-capital-city/)

**Putrajaya (Malaysia, 1995–)**
- The master plan covers about 4,600 ha, of which 1,826.5 ha (37%) is open space. Bernama gives 20 precincts totalling 4,931 ha. — [Planning Malaysia journal](https://mail.planningmalaysia.org/index.php/pmj/article/download/Article%202-1/37/77); [Bernama](https://www.bernama.com/en/news.php?id=2438340)
- The city has 20 precincts. The "core employment and commercial precincts" (Core Area) sit on an island in a man-made lake. The Core Area is 1,069 ha in five precincts, though another source implies about 1,308 ha. — [WIT Press paper](https://www.witpress.com/Secure/elibrary/papers/SC04/SC04009FU.pdf); [UNESCAP Putrajaya Green City](https://sdghelpdesk.unescap.org/sites/default/files/2018-03/Malaysia%20Putrajaya-into-Green-Growth-City.pdf)
- The central spine is a boulevard of about 4.2 km, given elsewhere as 4 km × 100 m wide or 4.5 km from the Prime Minister's Office to the International Convention Centre. — [Slideshare urban design](https://fr.slideshare.net/SuchetanaChakravarty/urban-design-79743058); [Penang travel tips](https://www.penang-traveltips.com/malaysia/putrajaya.htm)
- The plan includes a 400 ha artificial lake and 200 ha of wetlands, a projected 330,000 residents in 67,000 housing units, and Precinct 2 (ministries along the Boulevard) of 155.2 ha. — [Planning Malaysia journal](https://mail.planningmalaysia.org/index.php/pmj/article/download/Article%202-1/37/77); [Penang travel tips Precinct 2](https://www.penang-traveltips.com/malaysia/putrajaya/precinct-2.htm)

**Naypyidaw (Myanmar, 2005–)**
- The city is split into separate single-use zones: a ministry zone with identical ministry buildings, a 31-building parliament complex and a 100-room presidential palace; residential zones of 1,200 four-storey apartment blocks, with roof colour indicating the residents' ministry (blue = Health, green = Agriculture); about 50 mansions for high officials; a military zone where senior officers live about 11 km from ordinary government staff (reportedly with tunnels and bunkers), plus a restricted base; a diplomatic zone (2 ha per embassy or UN mission); a hotel zone of villa hotels on hilly outskirts (8 of 12 hotels); and Myoma Market as the commercial centre. — [Wikipedia: Naypyidaw](https://en.wikipedia.org/wiki/Naypyidaw)
- Uppatasanti Pagoda is 30 cm shorter than Shwedagon. The airport is 16 km south-east of the city, with a 3.6 km runway. The city has a "20-lane boulevard" that is largely empty, and the central railway station site measures 2,700 × 1,200 m. — [Wikipedia: Naypyidaw](https://en.wikipedia.org/wiki/Naypyidaw)
- The union territory is 7,054 km². Population is given as 358,679 (infobox) and 924,608 (text), which conflict. — [Wikipedia: Naypyidaw](https://en.wikipedia.org/wiki/Naypyidaw)

**IKN Nusantara (Indonesia, 2022–)**
- KIPP (Kawasan Inti Pusat Pemerintahan) is about 6,596–6,671 ha and sits on the south side of KIKN. Only about 1,760 ha (26%) is development area, and the rest is green. The first-stage focus is about 900 ha, and the 2028 "political capital" target is 800–850 ha. — [Lampiran Perpres 63/2022](https://ikn.go.id/storage/regulasi/lampiran-perpres-63-tahun-2022.pdf); [Fortune IDN](https://www.fortuneidn.com/news/kawasan-seluas-900-hektare-jadi-fokus-pertama-pembangunan-ikn-00-my5jv-08wc3d); [GNFI official map](https://www.goodnewsfromindonesia.id/2023/04/06/peta-resmi-ikn-dirilis-63-wilayah-bakal-jadi-hutan-kota); [Hukumonline Perpres 2028](https://www.hukumonline.com/berita/a/prabowo-teken-perpres--ikn-jadi-ibu-kota-politik-pada-2028-lt68ce4e0d43ad6)
- The Presidential Palace complex is planned at 100 ha and the Vice-President's palace at 14.58 ha. The ceremony field lies directly in front of the palace, facing the Sumbu Kebangsaan (national axis). The axis links the palace to the Mangrove Ecopark through a series of open spaces, and phase I was inaugurated at Plaza Seremoni on 14 Aug 2024. — [Antara Bali](https://bali.antaranews.com/berita/309297/istana-presiden-berdiri-di-kawasan-inti-ikn-nusantara-juli-2024); [OIKN press release 14 Aug 2024](https://ikn.go.id/storage/press-release/2024/20240814siaran-pers-presiden-resmikan-sumbu-kebangsaan-sebagai-ruang-publik-yang-i-1.pdf); [Medcom](https://www.medcom.id/properti/arsitektur/nbw0wOxk-jadi-simbol-harmonisasi-begini-desain-sumbu-kebangsaan-di-ikn-nusantara)
- The legislative and judicial precinct is targeted for the end of 2027, and the main complex for 2028. — [Investortrust](https://investortrust.id/business/79720/oikn-bidik-proyek-kawasan-legislatif-yudikatif-rampung-akhir-2027); [Jakarta Post](https://www.thejakartapost.com/business/2025/08/05/ikn-authority-says-main-complex-to-finish-by-2028-without-moratorium.html)
- Plan targets include 63% of the area as urban forest. — [GNFI](https://www.goodnewsfromindonesia.id/2023/04/06/peta-resmi-ikn-dirilis-63-wilayah-bakal-jadi-hutan-kota)

**Chandigarh (India, Mayer then Le Corbusier, 1950s)**
- The Capitol Complex sits at the head of the city on a "promontory in Sukhna's fork at the upper margin". The industrial area is to the south-east, and both positions were kept by Corbusier. — [Wikipedia: Chandigarh](https://en.wikipedia.org/wiki/Chandigarh)
- The plan uses sectors: 30 in phase 1 and 17 in phase 2. Mayer's superblocks were about 1 × 0.5 km. The plan has a seven-tier road hierarchy, from highway down to pedestrian path. The city covers 114 km², with a density of about 9,252–9,262 per km². Sukhna Lake (3 km² artificial lake, 1958) is in Sector 1. — [Wikipedia: Chandigarh](https://en.wikipedia.org/wiki/Chandigarh)
- The widely quoted 800 × 1,200 m sector size and Sector 17 as the CBD were not confirmed by the fetched text.

**Abuja (Nigeria, IPA plan 1979–81, Kenzo Tange central area)**
- The master plan was made by International Planning Associates (three US firms), with drawings dated 1979–1981. — [MIT Dome](https://dome.mit.edu/handle/1721.3/75081)
- The Central Area runs in sequence: Three Arms Zone → Ministries Zone → Cultural Zone → CBD. The Three Arms Zone is a circular area holding the Presidential Complex, the National Assembly and the Supreme Court. Kenzo Tange designed the Central Area/CBD, and his plan put the embassy zone outside the Three Arms circle. — [Trust Radio: Abuja Central Area](https://trustradio.com.ng/en/the-abuja-central-area-plans-and-realities-ii); [Wikipedia: Three Arms Zone](https://en.wikipedia.org/wiki/Three_Arms_Zone)
- Ceremony roads B-08 and B-10 exist in the plan. — [Trust Radio B-08/B-10](https://trustradio.com.ng/en/the-b-08-and-b-10-ceremony-roads-in-perspective)

### Inferences
- A repeatable capital template ("axis capital"):
  1. Pick a high point (hill or promontory) as the head. Place the presidential palace there (Canberra Capital Hill, Chandigarh Capitol, DC Jenkins Hill for Congress, IKN palace on a ridge).
  2. A ceremonial axis or boulevard 1.6–4.5 km long and 100–122 m wide (DC Mall 1.6 km × 122 m; Putrajaya 4.2 km × 100 m). Brasília's 16 km is an outlier because it spans the whole city.
  3. Ministries line both sides of the first 1–2 km of the axis (Brasília Esplanade, Putrajaya Precinct 2 at 155 ha, Abuja Ministries Zone).
  4. Executive, legislature and supreme court are grouped at the head as a triangle or circle: Brasília Three Powers Plaza, Abuja Three Arms circle, Canberra Parliamentary Triangle. For COUNTRY AI, place the President, Council and Court within about 300–800 m of each other at the head. This is an inference; exact distances were not sourced.
  5. The CBD sits at the far end or the middle of the axis (Abuja: CBD after the Cultural Zone). The cultural zone or museums sit between ministries and the CBD.
  6. Embassy/diplomatic zone just outside the core (Abuja, Naypyidaw), as small equal lots (Naypyidaw 2 ha each).
  7. Water: an artificial lake or a perpendicular water axis is common (Canberra, Putrajaya with a 400 ha lake, Chandigarh's Sukhna, IKN mangrove end).
  8. Housing in repeated modules: Brasília superquadra 280 m, Chandigarh sector about 0.5–1 km, Putrajaya precincts of tens to hundreds of ha. Naypyidaw colour-codes housing by ministry, which an AI sim could mirror by colouring housing by office or job.
  9. Open space of 37–63% for a green-capital feel (Putrajaya 37%, IKN 63% urban forest).
- Military: Naypyidaw puts senior military housing about 11 km from civil staff and the base in a restricted zone. Rule: the military base sits at the city edge or 5–15 km out, behind a restricted perimeter.
- Airport: Naypyidaw is 16 km out with a 3.6 km runway. Rule: the airport sits outside the urban radius, 10–20 km away, on flat land.
- For Neura City: total government core of about 100–200 ha (Putrajaya Precinct 2 at 155 ha; IKN palace complex at 100 ha) is a believable order of magnitude.

### Gaps
- Exact distances between palace, parliament, ministries and court (for example DC Capitol–White House, Brasília Planalto–Congress–STF, Putrajaya Perdana Putra–Palace of Justice) were not retrieved. Typical values need verification.
- Official IPHAN superquadra and Eixo Monumental widths, the Canberra lake and axis lengths, and Abuja Central Area dimensions were not obtained.
- The Chandigarh 800 × 1,200 m sector and V7 road naming are unconfirmed from the fetched text.

## Traditional town cores: Javanese alun-alun, Japanese castle town, European old town

### Takeaway
The Javanese "catur gatra tunggal" puts the palace or regency office, the great mosque, the market and often a prison around a central alun-alun square. The Japanese jōkamachi grades classes outward from the castle (samurai close, merchants along the streets, temple belt on the rim) and uses deliberately twisting streets for defence. These patterns are directly usable as "old town" templates for Kernel Falls or Lumen Bay.

### Cited Findings
- Catur gatra tunggal ("four elements in one"): keraton (palace), mosque, market and alun-alun form one unit at the town centre. It is associated with Islamic Mataram (Panembahan Senopati) and possibly older (Mataram Kuno, Majapahit). — [Atlantis Press HUNIAN 2019](https://www.atlantis-press.com/proceedings/hunian-19/125942551); [UIN Malang JIA (Lamongan)](https://ejournal.uin-malang.ac.id/index.php/JIA/article/download/13263/pdf)
- Important buildings (palace or government centre, grand mosque, market and prison) are placed around the alun-alun. In Bandung the old mosque, market and prison still stand around the square as heritage buildings. — [GNFI Bandung](https://www.goodnewsfromindonesia.id/2022/09/19/catur-gatra-tunggal-filosofi-mataram-islam-dalam-tata-ruang-alun-alun-bandung)
- Survival varies by town: the pattern is still well identified in Lamongan but questioned in Malang. — [UIN Malang JIA](https://ejournal.uin-malang.ac.id/index.php/JIA/article/download/13263/pdf); [UB student journal (Malang)](https://arsitektur.studentjournal.ub.ac.id/index.php/jma/article/view/388/370)
- Surakarta: the Masjid Agung, Pasar Klewer and the Kauman (religious quarter next to the mosque) form one spatial relationship. — [UMS repository](https://publikasiilmiah.ums.ac.id/xmlui/handle/11617/12648)
- Jōkamachi (castle town): samurai compounds are grouped near the castle, with higher-ranking retainers closer. The townsmen district (chōnin-chi) lies outside the samurai town, with smaller plots tightly aligned along streets. Temple districts (teramachi) form the outer rim and were conceived as part of the defences. Streets are narrow, turn, double back and dead-end for defence. Early towns had moats and walls only around the castle, later towns sometimes double or triple moats. — [Wikipedia: Jōkamachi](https://en.wikipedia.org/wiki/J%C5%8Dkamachi); [JAANUS](https://projects.mcah.columbia.edu/jaanus/node/3565)

### Inferences
- Alun-alun template: a square open field (size unsourced here; pick 150–300 m per side as a parameter) with the government building on the south or north side facing it, the mosque (or national temple) on the west side, the market off one corner, and the prison or police on another side. The orientation conventions (palace south/north, mosque west) are common knowledge but were not verified by the sources fetched.
- Castle-town template: rank by distance. Officials and elite live nearest the government core, merchants along the main streets, and a "temple belt" or large institutional lots on the rim. Give it organic, twisting streets instead of a grid.
- European old town (square, town hall, church or cathedral, market, ring road on former walls) was requested but not researched. See Gaps.

### Gaps
- No source fetched for the European old town (Marktplatz/Rathaus/Kirche pattern, Vienna Ringstraße on former walls).
- No sourced alun-alun dimensions or orientation rules.

## Port cities vs inland; tech/science cities

### Takeaway
Ports start as small piers next to the old centre and, as cargo grows and rail arrives, migrate outward and downstream to specialised and later container terminals (Bird's Anyport). That leaves an old waterfront next to the CBD and modern terminals further out. Tech cities such as Songdo are compact business districts of about 600 ha, organised around a central park of about 40 ha (about 10% of the area).

### Cited Findings
- Bird's Anyport model (James Bird, 1963): it describes the spatial spread of port infrastructure over time. It starts with small, shallow piers near the city centre, then extends marginal quays, then moves to specialised cargo handling for larger ships, pushing activity to sites far from the oldest facilities. Stage counts vary between five and six depending on the source. The model is driven by cargo throughput and improved land transport, especially railroads. — [Port Economics Management: Evolution of a port](https://porteconomicsmanagement.org/spatial-evolution-port/); [Gdynia Maritime Univ. journal](https://sj.umg.edu.pl/sites/default/files/SJ_116_04.pdf)
- Later amendments add phases such as closure, conversion (old docks into urban waterfront) and container terminals. A noted weakness is that the model lacks the port–city functional relationship (the port–city interface). — [Port Economics Management](https://porteconomicsmanagement.org/spatial-evolution-port/); [Borruso & Balletto 2023](https://iris.unica.it/bitstream/11584/368505/3/Borruso_Balletto%202023%20Paper%20accepted.pdf)
- McGee: in Southeast Asian cities the old colonial port is the focal point instead of a CBD (see the first section). — [TutorChase AP HG 6.5.7](https://www.tutorchase.com/notes/ap/human-geography/6-5-7-urban-models-in-southeast-asia)
- Songdo International Business District (Incheon) covers about 600 ha (607 ha in one source) of reclaimed waterfront land. Songdo Central Park is about 41 ha (101 acres), about 10% of the district. — [Wikipedia: Songdo](https://en.wikipedia.org/wiki/Songdo); [Wikipedia: Songdo Central Park](https://en.wikipedia.org/wiki/Songdo_Central_Park); [Site Selection 2008](https://siteselection.com/project-finance-site-selection-magazine-january-2008/)

### Inferences
- Port City template (Port Token): shoreline on one side. The old harbour (fishing quarter, old warehouses, customs house, market) sits next to the CBD. Modern container terminals are 2–5 km along the coast, served by rail and a freight road, and the industrial or logistics wedge runs inland from the terminals. A naval base sits on a separate, fenced stretch of coast away from the commercial port. Housing grows polycentrically (McGee) with an informal ring at the edge.
- Tech City template (Datahaven): a compact core of about 600 ha with a central park of about 10% of the area, a research or university campus as a separate nucleus, and a data-centre or industrial park near the power and water source. Tsukuba, Cyberjaya and BSD City were not sourced.

### Gaps
- No sourced figures on Tsukuba, Cyberjaya or BSD City layouts.
- No sources on naval base siting, customs house siting or fishing-quarter placement.

## Road hierarchy, block sizes, service spacing, city radius

### Takeaway
Real grid blocks range from about 60 m (Portland) through 113 m (Barcelona) and 280 m modules (Brasília) to superblocks of 0.5–1 km (Chandigarh). Short blocks are considered better for walkability. No reliable sources were found in this pass for police-station or school spacing or for city radius versus population.

### Cited Findings
- Portland blocks are about 200 ft (60 × 60 m). — [Pedestrian accessibility in grid layouts (paper)](https://media.voog.com/0000/0036/2451/files/Pedestrian%20accessibility%20in%20grid%20layouts-%20the%20role%20of%20block,%20plot%20and%20street%20dimensions.pdf); [Planetizen](https://planetizen.com/node/90868)
- Barcelona Eixample blocks are 113.33 m per side on 20 m streets. — [Ordre spontané: L'exemple de l'Eixample](https://ordrespontane.substack.com/p/lexemple-de-leixample)
- Manhattan's 1811 block length turns out to be almost optimal for pedestrian accessibility (Harvard research). Dimensions conflict: Strong Towns gives 600 × 250 ft (about 183 × 76 m), while other figures circulate at about 264 × 900 ft (80 × 274 m). — [Harvard Gazette](https://news.harvard.edu/gazette/story/2017/01/why-city-blocks-work); [Strong Towns](https://archive.strongtowns.org/journal/2013/11/27/optimizing-the-street-grid.html)
- Brasília superquadra is 280 × 280 m (lower-authority source). Chandigarh's Mayer superblock is about 1 × 0.5 km, with a seven-tier road system. — [visiearth](https://visiearth.pages.dev/br/the-capital-city/); [Wikipedia: Chandigarh](https://en.wikipedia.org/wiki/Chandigarh)
- Ceremonial road widths: DC Mall 122 m and avenue 49 m; Putrajaya boulevard 100 m; Naypyidaw "20-lane boulevard". — [Wikipedia: L'Enfant Plan](https://en.wikipedia.org/wiki/L%27Enfant_Plan); [Penang travel tips](https://www.penang-traveltips.com/malaysia/putrajaya.htm); [Wikipedia: Naypyidaw](https://en.wikipedia.org/wiki/Naypyidaw)
- Density reference: Chandigarh has about 9,250 people per km² over 114 km². Putrajaya plans 330,000 people on about 4,600 ha (about 7,200 per km² gross). — [Wikipedia: Chandigarh](https://en.wikipedia.org/wiki/Chandigarh); [Planning Malaysia journal](https://mail.planningmalaysia.org/index.php/pmj/article/download/Article%202-1/37/77)

### Inferences
- Road hierarchy for generation (loosely modelled on the Chandigarh seven-tier system): (1) regional highway or ring road at the city edge; (2) ceremonial axis or boulevard, 60–120 m; (3) arterials 30–50 m bounding superblocks or sectors every 500–1,000 m; (4) collectors 20 m (Eixample) every 110–280 m; (5) local streets 10–15 m; (6) lanes or gang 2–5 m inside informal or kampung areas (width unsourced); (7) pedestrian paths in parks.
- Block size by zone: CBD 80–120 m (Eixample/Manhattan short side), residential modular 200–280 m superblock with internal lanes, industrial 200–500 m, old town irregular 40–80 m (unsourced estimate).
- City radius: with about 2,000 citizens per COUNTRY AI city (10,000 / 5) and each agent representing many people, the map size is a free design choice. One option is a 3–6 km radius (about 30–110 km²), the Chandigarh/Putrajaya order of magnitude, if each agent stands for about 100–300 people. Not sourced.
- Service spacing (police posts, schools): use a catchment rule. Assumption: one police post per sector or superblock (about 1 km grid), the police HQ next to the government core, one primary school per residential superblock, and secondary schools every 2–3 superblocks. These are planning heuristics and not sourced here.

### Gaps
- No sources were retrieved for standard police-station or school catchment distances, ring-road radii, city-radius-to-population ratios, or Indonesian kampung lane widths. They need a follow-up search (for example SNI 03-1733-2004 for Indonesian neighbourhood facility standards, or UN-Habitat street-network guidance).

## Placement of military bases, police HQ, prisons, airports, industry, cemeteries

### Takeaway
Only partial sourced evidence exists. Naypyidaw puts the military zone about 11 km from civil housing in a restricted area and the airport 16 km out. Chandigarh puts industry on the south-east edge away from the Capitol. The Javanese alun-alun historically put the prison beside the central square. Everything else is a heuristic.

### Cited Findings
- Military: a senior officers' complex about 11 km from regular staff and a restricted base needing written permission (Naypyidaw). — [Wikipedia: Naypyidaw](https://en.wikipedia.org/wiki/Naypyidaw)
- Airport: 16 km south-east of Naypyidaw, with a 3.6 km runway. — [Wikipedia: Naypyidaw](https://en.wikipedia.org/wiki/Naypyidaw)
- Industry: south-east of Chandigarh, on the opposite side from the Capitol head. — [Wikipedia: Chandigarh](https://en.wikipedia.org/wiki/Chandigarh)
- Prison: placed on the alun-alun next to the palace, mosque and market in traditional Javanese towns (Bandung still has the old prison there). — [GNFI Bandung](https://www.goodnewsfromindonesia.id/2022/09/19/catur-gatra-tunggal-filosofi-mataram-islam-dalam-tata-ruang-alun-alun-bandung)
- Industry follows transport: the Anyport model makes rail-linked port expansion drive specialised terminals away from the centre. — [Port Economics Management](https://porteconomicsmanagement.org/spatial-evolution-port/)
- Temples (large institutional lots) on the defensive rim of Japanese castle towns. — [Wikipedia: Jōkamachi](https://en.wikipedia.org/wiki/J%C5%8Dkamachi)

### Inferences
- Generation rules:
  - Military base at the edge or 5–15 km out, behind a fenced restricted perimeter. In the capital, add a small guard post or "presidential guard" next to the palace (unsourced).
  - National police HQ inside or adjacent to the government core (sim: next to the Ministry of Interior). Precinct stations, one per sector.
  - Modern prison on the outskirts on a large walled lot. A historic "old prison" on the alun-alun can be kept as a heritage building in old towns.
  - Airport 10–20 km out, rectangular runway strip, on the opposite side from hills.
  - Industry in a wedge on the opposite side from the government head (Chandigarh) and along rail or port. Downwind placement is a heuristic, unverified.
  - Cemeteries at the edge or on former outskirts, swallowed by later growth (unsourced).

### Gaps
- No sources were retrieved on prison siting in modern planning, cemetery siting, wind-based industrial siting, or police HQ placement in planned capitals (for example Brasília, Putrajaya). A follow-up search is needed if these must be sourced.
