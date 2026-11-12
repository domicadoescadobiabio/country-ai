# City-builder and society-sim mechanics as inspiration for the COUNTRY AI browser city map

Scope: mechanics and rendering techniques to borrow, not copy, for a map of 5 cities, 10,000 AI citizens and the full government (President, ministers, 30-seat council, judges, police, military, mayors, election commission, Academy, prison) in vanilla JS. Research date 12 Nov 2026. Numbers come from the cited sources. Anything I could not source is listed under Gaps.

## 1. SimCity (2013 / SimCity 4) and Cities: Skylines I and II: services, coverage, capacity, zoning, citizens, info views, simulated vs drawn

### Takeaway
Modern city builders measure service coverage **along the road network**, not as a circle. Each building gets a **range** (meters of road), a **capacity** (roughly how many people it serves) and a **fleet** (patrol cars, vans) whose size follows funding or efficiency. The two famous agent designs show the core tradeoff. SimCity 2013 dropped persistence (any sim takes the nearest free job or house each day) so it could scale. Cities: Skylines II keeps persistent households with lifepaths and pathfinding costs, but pays for it in CPU. For COUNTRY AI, citizens are already persistent in the database, so the map only needs to **visualise** them, not simulate movement.

### Cited Findings
**Coverage and capacity (Cities: Skylines II, developer source)**
- Passive service effects are measured as a **range in meters along roads**, plus a **capacity** that roughly estimates how many people the effect reaches. Dense housing shortens the reach. The effect is full across most of the range and fades quickly at the edge. Services with passive effects are healthcare, elementary schools, fire, police, parks and welfare offices. — [Colossal Order: City Services dev diary](https://colossalorder.fi/?p=1688)
- Police stations and HQs reduce crime accumulation in their neighbourhoods. Patrol cars lower crime probability along the routes they drive and can cover the whole city unless districts restrict them. Every building has a crime probability that also lowers citizen well-being. — [Colossal Order](https://colossalorder.fi/?p=1688)
- Sentenced criminals go to a local prison, or to an outside connection if none exists. Prisons also produce resources for industry, and released prisoners have their criminal status reset. — [Colossal Order](https://colossalorder.fi/?p=1688)
- "Service Efficiency determines the number of available vehicles for most services." Services can be restricted to one or more districts, and there are 7 district policies and 5 city policies. — [Colossal Order](https://colossalorder.fi/?p=1688)
- Education has 5 levels (Uneducated to Highly Educated), and each graduation raises a citizen's level by one. Elementary schools give a well-being bonus to families with children living nearby, and the school's short coverage range is drawn green on the roads. — [Colossal Order](https://colossalorder.fi/?p=1688); [search summary of CO dev diary](https://colossalorder.fi/?p=1983)
- In CS1, building a police or fire station automatically served the whole city. In CS2, districts let you place stations selectively in high-crime districts. — [PCGamesN: CS2 districts](https://www.pcgamesn.com/cities-skylines-2/districts)
- The CS2 Police info view shows total jail and prison availability and average crime probability. It highlights police buildings, prisons, police cars and prison vans, colours roads green-to-red by police coverage, and colours buildings green-to-red by crime probability. — [gameplay.tips CS2 info views](https://gameplay.tips/guides/cities-skylines-ii-info-views-guide.html)
- The CS2 modding docs expose coverage as a pathfinding job: `CoverageJob`, `CoverageParameters`, `CoverageResult`, `ServiceCoverage` per net edge and `ModifiedServiceCoverage` per building. This suggests coverage is a cost-limited flood fill over road edges, which is my inference from the class names. — [CS2 Modding Guide index](https://ps1ke.github.io/Cities-Skylines-2-Modding-Guide/Game/Simulation/ServiceCoverageSystem)

**Capacity numbers (Cities: Skylines I, fan wiki stub)**
- Police Station: 10 patrol cars, capacity 20. Police HQ: 25 cars, capacity 100. Prison (After Dark DLC): 5 prison vans, capacity 300. — [Skylines Wikia: Police department](https://skylines.fandom.com/wiki/Police_department)
- In CS1, if a neighbourhood keeps a high crime level or a call goes unanswered by a police car for too long, its buildings can become abandoned. — [Skylines Wikia](https://skylines.fandom.com/wiki/Police_department)
- A modder describes a police station's effect as a street-based radius, unlike a park's circular area. — [Steam: Service Radius Adjuster comments](https://steamcommunity.com/sharedfiles/filedetails/comments/785237088)

**Citizens, commuting and pathfinding**
- CS2 pathfinding cost combines **Time, Comfort, Money and Behaviour**, and each citizen picks the lowest total cost. Teens weight money, adults weight time and seniors weight comfort. Parking fees and travel distance shift choices. Freight prefers local sales because longer deliveries cost more. CS1 pathfinding was proximity-based. — [Colossal Order: Traffic AI dev diary](https://colossalorder.fi/?p=1597)
- CS2 citizens are primary agents living in multi-generation households, each with a **lifepath**: graduating, finding a spouse, getting a job, moving home or leaving the city. A Lifepath Journal logs the events of followed citizens. Households balance income, spending and resources, and what they buy depends on household type (teens buy electronics more often than seniors). — [Paradox: CS2 citizen simulation & lifepath](https://www.paradoxinteractive.com/games/cities-skylines-ii/features/citizen-simulation-lifepath); [GamesRadar](https://gamesradar.com/cities-skylines-2-promises-an-improved-city-building-sim-that-lets-you-follow-every-last-citizen-and-watch-their-life-events)
- CS2 has **no hard agent limit**, so population depends on hardware, and the simulation is multithreaded. — [Colossal Order](https://colossalorder.fi/?p=1597); [PC Gamer](https://www.pcgamer.com/cities-skylines-2-has-no-cap-on-the-number-of-people-it-can-track-and-its-basically-the-matrix)
- CS1 had hard caps (community-reported, not official): ~1M citizens, 524k citizen units, **65,536 citizen instances** (people physically walking or driving) and `MAX_VEHICLE_COUNT = 16384`. So CS1 drew only a fraction of its simulated population. — [Steam discussion](https://steamcommunity.com/workshop/filedetails/discussion/531738447/481115363859488292); [GamesRadar](https://www.gamesradar.com/cities-skylines-2-removes-the-agent-limit-finally-letting-city-builder-fans-utterly-melt-their-machines)

**SimCity 2013 GlassBox**
- Earlier SimCity games simulated high-level statistics and then drew animation to match. GlassBox instead simulates **agents** (water, power, workers and so on), and every animation corresponds to an agent's real activity. The city is built from roads, agents and units, not grid cells. — [Wikiwand: SimCity (2013)](https://www.wikiwand.com/en/articles/SimCity_(2013)); [SimCity fandom](https://simcity.fandom.com/wiki/SimCity_(2013))
- Andrew Willmott's GDC 2012 talk "Inside GlassBox" covers the architecture, with PDF slides linked. GlassBox was first aimed at a series of mobile games. — [andrewwillmott.com](https://www.andrewwillmott.com/talks/inside-glassbox)
- **Non-persistence:** sims go to the nearest available job and, if the commute takes too long, give up and go home. PC Gamer confirmed that sims can work at a different job each morning and sleep in a different house each night. Lead designer Stone Librande said sims own no particular house and have no permanent job, and Maxis called this necessary for performance. Critics tied it to the small city sizes and to the "phantom Sims" population figure. — [PC Gamer: SimCity tested](https://www.pcgamer.com/simcity-tested-offline-play-phantom-sims/); [MCV: Maxis responds](https://www.mcvuk.com/maxis-finally-responds-to-simcity-ai-concerns-admits-there-is-a-problem/); [Medium critique](https://medium.com/@chrominance/simcity-the-most-disappointing-game-of-2013-3e9157cb80db)

### Inferences
- **Coverage model to borrow:** give each service building `range` (in map or road distance), `capacity` (citizens served) and `units` (officers or vehicles). Draw coverage by colouring **road segments** green-to-red, as the CS2 info views do. Compute it with a Dijkstra or BFS flood fill from the building over the road graph, cut off at `range`. With a few hundred road nodes per city this is cheap enough to precompute at load.
- **Map real data, not invented coverage:** COUNTRY AI already has 25 police, 20 military and 5 mayors. A "police station" building's capacity could be its officers × N citizens, and its coverage colour could show real arrests, incidents and reports per district. Avoid inventing simulated crime probabilities that the backend doesn't have.
- **Persistence lesson:** the backend already has persistent citizens (`citizens` table, city, office). Do not repeat the SimCity mistake of drawing a dot as "going to work" when the citizen's actual action was "rest". Each drawn agent should take its destination from its real latest daily action (work→workplace, shop→shop, study→school/Academy, run→Election Commission, apply→Academy, help/volunteer→a neighbour or community building, talk→plaza, rest→home, crime→hidden or underworld, arrested→police station→court→prison).
- **Info views:** one toggleable overlay per ministry (Police/Crime, Education/Academy, Welfare/UBI, Economy/shops, Elections/turnout), with roads or buildings coloured green-to-red and a side panel of totals. This mirrors the CS2 police panel (jail/prison capacity plus average crime).
- Mirror the CS1 caps idea: simulate (or know) all 10,000, but **draw a capped sample** (CS1 drew up to 65,536 instances out of ~1M citizens).

### Gaps
- No official coverage radius in meters for CS1/CS2 police, school or hospital buildings. The dev diary gives none, and the modding page I fetched was only an index.
- CS1 Dev Diary 9 (Info Views) returned HTTP 500, so its exact text is not verified.
- SimCity 4 radius-based coverage (circle radius per station) and its R/C/I density tiers are not sourced here. I did not reach a SimCity 4 primary source, so treat this as general knowledge only.
- R/C/I zoning densities for CS2 (low/medium/high residential, commercial, industrial, office) are not sourced in this session.
- I did not read the GlassBox slide internals (units/agents/rules/maps). The PDF is linked from Willmott's page.

## 2. Tropico, Dwarf Fortress/RimWorld, Victoria 3/Democracy, Banished/Anno/Foundation, Frostpunk, Townscaper/Islanders, Pocket City/Mini Metro

### Takeaway
The government-sim games show institutions in two ways. Tropico uses physical buildings with an area overlay (police stations, palace, prison, crime heat-map). Victoria 3 uses abstract national institutions funded by bureaucracy, with no map footprint. A COUNTRY AI map can mix both: real buildings for city-level institutions (police station, city hall, school, shop, Academy, court, prison, council chamber, palace) and HUD panels for national abstractions (treasury, laws, ledger). Small-village builders (Banished, Foundation) show that a simple "nearest building / market radius" rule reads well. Mini Metro shows that minimal shapes plus pinch-zoom work on phones.

### Cited Findings
- **Tropico 6:** police stations are placed using the City overlay, where redder areas mean higher crime. Police stations and media buildings can reveal citizens with hidden roles. Arresting a kingpin needs a police station plus a prison. The "Military Police" edict makes military buildings act as police stations but greatly reduces freedom nearby and worsens relations with militarists. Elections decide whether you can keep playing, and factions (e.g. Capitalists, appearing after the Colonial era) often oppose one another. — [Gamepressure Tropico 6 politics](https://www.gamepressure.com/tropico-6/politics-and-constitution/z8c0a4); [Gamewatcher: speakeasy kingpin](https://www.gamewatcher.com/tropico-6-speakeasy-how-to-arrest-kingpin-strike-a-shady-deal); [Gamepressure edicts](https://www.gamepressure.com/tropico-6/edicts/z9c0a5); [GameRant factions](https://gamerant.com/tropico-6-every-faction-explained-guide/)
- **Victoria 3 institutions:** institutions are government services such as schools, workplace safety, conscription offices, militarized police and poorhouses. Establishing one needs enough bureaucracy plus an enabling law. Bureaucracy comes from Government Administration buildings, and its cost scales with population in incorporated states. A bureaucracy deficit causes tax waste. Police mainly reduce Turmoil. Players debated whether police should be physical buildings rather than abstract institutions. — [Victoria 3 Dev Diary 8: Institutions](https://forum.paradoxplaza.com/forum/threads/victoria-3-dev-diary-8-institutions.1484231/); [gameplay.tips institutions guide](https://gameplay.tips/guides/victoria-3-institutions-guide.html)
- **Banished:** players say houses must be inside a market's radius, while mines and forestry don't need to be. A community list gives the level-1 market radius as 10 (unconfirmed). The town hall is a statistics building that shows job counts per profession, not a service radius. The exact effect of the market circle is poorly documented. — [Crate forums](https://forums.crateentertainment.com/t/please-make-radius-shown-for-other-buildings-like-for-market/119223); [Banished wiki: Town hall](https://banished.fandom.com/wiki/Town_hall); [Crate forums radii list](https://forums.crateentertainment.com/t/list-of-building-grids-and-radiuses-that-affect-shelters/115829)
- **Foundation:** a forum answer (not official) says markets and churches have no set radius and villagers walk to the **nearest** one. It advises keeping work and housing within 1–2 map hexes. — [Steam discussion (Foundation)](https://steamcommunity.com/app/690830/discussions/0/1629664606988021426)
- **Townscaper:** uses the wave function collapse (WFC) algorithm, implemented quite differently from Stålberg's earlier Bad North. Stålberg calls it part of "an ongoing exploration of tile-based procedural generation". — [MCV: When we made Townscaper](https://mcvuk.com/business-news/when-we-made-townscaper); [Game Developer: How Townscaper works](https://www.gamedeveloper.com/game-platforms/how-townscaper-works-a-story-four-games-in-the-making)
- **Mini Metro:** deliberately minimal visuals of simple shapes and lines styled like a real metro map. Peripheral information is pushed to the side and grouped, leaving the play area clear. Pinch-zoom was called a "big breakthrough" for the mobile version. It has colourblind palettes and a night mode. — [Mechanics of Magic: visual design of Mini Metro](https://mechanicsofmagic.com/2023/04/22/visual-design-of-games-mini-metro/); [Kill Screen](https://www.killscreen.com/mini-metro-now-lets-fix-subway-youre-riding-subway/); [Android Central review](https://www.androidcentral.com/mini-metro-retro-review)

### Inferences
- **Building catalogue for the map:** borrow Tropico's mix of institutional buildings alongside ordinary ones. Per city: City Hall (mayor), Police Station (with holding cells for "arrested/held"), Shops/Market, School, Workplaces, Homes (block-level, not per-citizen), Plaza (talk), Community Centre (help/volunteer). National, placed in a capital district: Presidential Palace, Council Chamber (30 seats), Ministries (8), Constitutional Court, Prison, Military Base, Election Commission, Academy, National Ledger/Treasury. Real government seats are known, so each building can list its real occupants on click.
- **Tropico's "reveal hidden roles":** COUNTRY AI's underworld (hidden fraud found by the Audit office) fits this. Show crimes on the map only **after** detection or arrest, so the map never leaks hidden state the police don't know yet. This matters for game integrity.
- **Nearest-building destination rule** (Foundation and SimCity): for drawn agents, pick the nearest building of the needed type in the citizen's own city, maybe with a small random choice among the 2–3 nearest so streets don't all converge. This is enough for visuals.
- **Victoria 3 lesson:** national institutions without a single location (laws, budget, ledger) belong in panels or overlays, not fake buildings.
- **Mini Metro lesson for phones:** flat, minimal shapes, a clear colour per building category, HUD at the edges, pinch-zoom plus pan, and a colourblind-safe palette with a dark mode.

### Gaps
- No sources reached for Dwarf Fortress/RimWorld rooms, jobs and needs, Frostpunk (law book, laws as a building-free institution), Anno service radius, Islanders, Pocket City touch UI, or Positech's Democracy series. These remain general knowledge only and should not be cited.
- I found no source for the Tropico 6 police station radius value or the prison capacity.

## 3. Isometric vs top-down rendering in the browser: tiles, sprites, thousands of moving dots, camera, LOD, picking, mobile

### Takeaway
For 10,000 citizens across 5 cities on a phone, use a **top-down (or lightly stylised) 2D canvas**. Pre-render static layers (roads, blocks, buildings) to offscreen canvases or chunks, and redraw only a dynamic layer of a few hundred to ~2,000 sampled agent dots per frame. MDN's canvas and tilemap guidance covers layered canvases, pre-rendering, integer coordinates, batching, `alpha:false`, devicePixelRatio scaling, drawing only visible chunks, and requestAnimationFrame. Isometric is possible (SimCity 2000 is MDN's example) but makes picking and phone readability harder.

### Cited Findings
- MDN canvas optimisation tips:
  - Pre-render repeated or complex drawing on an offscreen canvas.
  - Use integer coordinates to avoid sub-pixel rendering (`Math.floor`).
  - Split into layered canvases (background / game / UI) so only changing layers redraw.
  - Avoid `shadowBlur`.
  - Use `getContext('2d', {alpha:false})`.
  - Batch calls (e.g. one polyline instead of many lines).
  - Scale by `devicePixelRatio` for sharp high-DPI output.
  - Use `requestAnimationFrame` rather than `setInterval`.
  - Use CSS for large static backgrounds and cache scaled images.
  - Render only screen differences.
  - [MDN: Optimizing canvas](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas)
- MDN tilemaps:
  - Keep all tiles in one atlas (index = id).
  - Square tiles suit top-down and isometric suits simulation (SimCity 2000).
  - Convert world↔screen coordinates with a camera.
  - Draw only visible tiles.
  - Use layers, plus a separate logic grid for path-finding.
  - Pre-render the map to an offscreen canvas or WebGL texture. This fails for very large maps because of texture-size limits.
  - Use a canvas 2×2 tiles larger than the view so it redraws only when scrolling crosses a tile.
  - Split large maps into chunks (e.g. 10×10 tiles), each pre-rendered as one "big tile".
  - [MDN: Tilemaps](https://developer.mozilla.org/en-US/docs/Games/Techniques/Tilemaps)
- The "draw a sample" principle is industry practice: CS1 capped drawn citizen instances at 65,536 while tracking ~1M citizens (community figures). — [Steam discussion](https://steamcommunity.com/workshop/filedetails/discussion/531738447/481115363859488292)

### Inferences (design proposals, not sourced facts)
- **Layers:**
  - (1) static base canvas per city: land, districts, roads, building footprints, pre-rendered once per zoom band and blitted.
  - (2) overlay canvas: info-view colouring, redrawn on toggle.
  - (3) agent canvas: dots every frame.
  - (4) DOM/SVG HUD: labels, building popovers, accessible buttons.
- **Agent sampling:** draw at most ~1,500–3,000 dots overall (e.g. 300–600 per visible city). Choose the sample deterministically per citizen id (hash(id) mod N), so the same citizens are always the visible ones and clicking a dot opens a real profile. Weight officials and recent actors so the interesting ones are visible.
- **Aggregate at low zoom:** at country zoom, show each city as a disc with counts per action (work/shop/study/…) as a ring chart or animated flow particles between building categories. Zoom in to see individual dots. That gives three LOD levels: country → city → district.
- **Movement:** interpolate each dot along a precomputed polyline from home block to destination building (path = road-graph shortest path cached per (block, building) pair). Use one `fillRect` of 2–3 px per dot, batched by colour (set `fillStyle` once per action colour), integer coordinates, no shadows.
- **Picking:** keep a uniform-grid spatial hash (e.g. 32 px cells) of buildings and drawn agents. Look up the click cell plus its neighbours, use a ≥44 px hit radius on touch, and show a bottom sheet on phones.
- **Camera:** pointer events with pinch-zoom (two pointers) and drag-pan, clamped zoom levels, `requestAnimationFrame` only while something moves. Pause the animation when the tab is hidden.
- **Accessibility:** a building legend with shape + colour (not colour alone), colourblind palette, a reduced-motion mode where agents become static density shading, and a text table alternative (list of buildings and occupants).
- **Isometric vs top-down:** top-down is recommended for v1 because picking is simple, labels are readable on a phone and there are no sprite assets to make. A lightly extruded "2.5D" look (offset darker side rectangle per footprint) gives depth cheaply. Full isometric needs a diamond→grid transform for picking and depth sorting.

### Gaps
- No benchmark source found for how many `fillRect` dots per frame 2D canvas sustains on mid-range phones. Needs a local test on the user's own map prototype.
- OffscreenCanvas in a Web Worker was not covered by the fetched MDN page.
- WebGL instancing (e.g. for >20k dots) was not researched.

## 4. Procedural city generation for a seed-based browser map: techniques and open-source JS implementations with licences

### Takeaway
Parish & Müller (SIGGRAPH 2001) is the root technique: an extended L-system for roads, driven by **global goals** (density, grid/radial patterns) and **local constraints** (water, terrain, snapping to intersections), followed by lot subdivision and buildings. Ready browser implementations exist: probabletrain/MapGenerator (TypeScript, **LGPL-3.0**, tensor-field streets per its docs site) and watabou's Medieval Fantasy City Generator (Voronoi wards/districts, **GPL-3.0** source in Haxe). WFC (Townscaper-style) fits tile-based visual detailing. Because of the copyleft licences, the safest route for COUNTRY AI is to **implement a small seeded generator ourselves** (seeded PRNG + grid/radial road skeleton + Voronoi districts + block subdivision) and use these projects only as references.

### Cited Findings
- **Parish & Müller, "Procedural Modeling of Cities", SIGGRAPH 2001, pp. 301–308:**
  - Extends L-systems with global goals and local constraints for street maps.
  - Global goals: population density, commerce vs suburban, superimposed grid or radial patterns. Local constraints: land, water, vegetation, elevation.
  - Example local rules: create a crossing where two streets intersect, and extend a street to reach a nearby crossing.
  - The full pipeline goes from input maps to streets, then land subdivision into lots, then buildings.
  - [SIGGRAPH history archive](https://history.siggraph.org/?p=116923); [phiresky presentation](https://phiresky.github.io/procedural-cities/presentation.html); [tfdml blog implementation notes](https://tfdml.blogspot.com/2015/03/procedural-city-generation.html)
- Chen et al. 2008 (tensor-field street modelling) builds on Parish & Müller. — [Chen et al., "Interactive procedural street modeling" PDF](https://web.engr.oregonstate.edu/~zhange/images/street_sig08.pdf)
- **probabletrain/MapGenerator:**
  - Generates American-style city maps automatically or step by step.
  - Exports PNG, SVG and STL, with several styles (map colours, hand-drawn sketch).
  - Written in TypeScript with Gulp. "Distributed under the LGPL-3.0 License" (the repository also contains GPL-3.0 text).
  - Demo at https://probabletrain.itch.io/city-generator, docs at https://maps.probabletrain.com.
  - [GitHub](https://github.com/probabletrain/MapGenerator)
- **watabou Medieval Fantasy City Generator:**
  - Began as city-shaped Voronoi diagrams. Wards are the basic units, and v0.7.0 added named districts built from clusters of wards.
  - v0.7.3 replaced a naive Bowyer-Watson with a port of **Delaunator** for the Voronoi stage.
  - Made with Haxe + OpenFL. Source repo TownGeneratorOS is "GPL-3.0 license" and lacks newer features (water bodies, options UI).
  - [itch devlog 0.7.0](https://watabou.itch.io/medieval-fantasy-city-generator/devlog/85275/070-districts); [devlog 0.7.3](https://watabou.itch.io/medieval-fantasy-city-generator/devlog/112574/073-bug-fixes-geojson-export); [GitHub TownGeneratorOS](https://github.com/watabou/TownGeneratorOS)
- **Wave Function Collapse:**
  - Originated with Maxim Gumin (mxgmn), whose GitHub repo dates from 30 Sep 2016, before the first academic paper.
  - JS port by Kevin Chapelier (github.com/kchapelier/wavefunctioncollapse) and a TypeScript WebGL port of the 3D tiled model (Vasu Mahesh, WFC_WebGL) are listed in the repo README.
  - [SIGMM record](https://records.sigmm.org/?p=12589); [GitHub mxgmn/WaveFunctionCollapse](https://github.com/mxgmn/WaveFunctionCollapse)

### Inferences
- **Suggested seeded pipeline (own code, no copyleft):**
  1. Seeded PRNG (e.g. mulberry32 from the city id).
  2. Pick a city layout pattern per city (grid, radial, organic) as the Parish & Müller global goal, so the 5 cities look distinct.
  3. Road skeleton as major avenues plus a subdivided minor grid with jitter.
  4. Voronoi districts (Delaunator is ISC-licensed per my knowledge; verify) labelled civic / commercial / residential / industrial, like watabou's wards.
  5. Recursive block subdivision into lots.
  6. Place institutional buildings first (City Hall at the centre, police station per district, school, shops on avenues), then fill houses.
  7. Store the result as JSON so the map is identical for every viewer and stable across reloads.
- Using probabletrain (LGPL-3.0) as an unmodified, separately loaded library is generally permissible under LGPL with notice. Copying its code into our bundle would bring LGPL obligations. watabou's code is GPL-3.0, so copying it would make our distributed frontend GPL. Recommend reference-only use for both. This is not legal advice.
- WFC is more useful for decorative detail (rooftops, parks) than for road layout. It is probably overkill for v1.

### Gaps
- I could not see the mxgmn/WaveFunctionCollapse licence text (the page linked a LICENSE file without content), so its licence is unverified here. Same for the kchapelier JS port.
- Delaunator's licence was not verified in this session.
- I did not confirm that probabletrain uses tensor fields and streamlines (the README doesn't say). Its docs site maps.probabletrain.com was not fetched.
- No source fetched for L-system JS libraries, Voronoi block subdivision tutorials, or Oskar Stålberg's irregular-grid talk.
