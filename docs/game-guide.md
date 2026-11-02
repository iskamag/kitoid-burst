# Kitoid Burst: flight, growth, and terrain

A flight playground for nine-eyed kitoids over an endless copper-and-teal heightfield. Seeds produce compact, elongated, flattened, bulky, and branching forms, with a shared feline reading from the terminal growth field and forward sensory sites.

## Run

Node 20.11 or later; no installation or build step is required.

```sh
npm start
```

Open **http://localhost:4173**, or this machine's LAN address on port 4173. The server binds to `0.0.0.0`; `PORT` overrides the port. Rendering code and fonts are vendored. The game makes no external requests. WebGL 2 is required.

## Fly

Click **Take flight**. Explore freely or follow a line over the folds and through the passes. **N**, or the route name at the top right, selects the Copper Cut, Needle Run, Highline, or the Long Way Home. They have 7, 8, 9, and 22 gates. The bearing arrow points towards the next gate, including when it is behind you. Each route has its own locally stored personal best.

Pitch and yaw act in the creature’s local frame, including while banked or inverted. Full loops are possible. Linear and angular momentum ease out when you release the controls. Slow frames are subdivided before flight, gate, and roll updates; catch-up is bounded to half a second after a long stall. Trail emission uses elapsed time rather than display frame rate. Slow contact slides peacefully along rock. A normal impact of at least 45 m/s causes a 1.2-second timeout, shown with a countdown. The cat rebounds and keeps coasting and colliding while steering and thrust are disabled. Controls return after the countdown; swept collisions prevent tunneling through terrain and arches. Skim near rock to build flow, increase the score multiplier, and recharge burst faster. Passing gates also restores charge.

| Input | Action |
| --- | --- |
| W / S or up / down | Pitch up / down |
| A / D or left / right | Turn left / right in the chase view |
| Mouse drag / two-finger drag | Orbit the flight camera |
| Mouse wheel / pinch | Zoom the camera |
| V | Reset camera to chase view |
| Shift | Burst |
| Space / X | Airbrake; slower flight and tighter turns |
| Q / E or Z / C | Hold to roll left / right; double tap for a fast spin |
| B | Toggle automatic horizon correction (starts off) |
| G | Open / close the growth editor |
| F | Cycle light, depth, and dense distance fog |
| P / Escape / H | Pause and flight manual |
| R | Restart the circuit |
| N | Start another route in the current reach |

Clicking Take flight focuses the canvas. Flight keys are captured before page shortcuts. Holding roll rotates the physical steering frame and the chase camera. Bank a quarter turn and pitch to turn across the landscape; roll inverted and pitch towards the ground. Bank persists when you release roll. **B** explicitly enables optional horizon correction. Braking sheds sideways momentum and increases steering response; burst carries more drift through a turn. A double tap adds a complete fast spin around the same local axis, with steering available throughout. Completing a spin near rock awards 350 points and 25% burst charge; a spin through a gate adds 500 points and 22% charge to the normal gate reward.

The roll axis, double-tap spin, angular damping, and brake-to-manoeuvre interaction draw on [Kitten Burst’s developer notes](https://store.steampowered.com/news/posts/?enddate=1706293114&feed=steam_community_announcements); this is an independent flight model. Grazing rock while bursting reduces energy drain by up to 75%; gliding near rock recharges it faster. A standard gamepad uses the left stick for flight, right stick for camera, bumpers for roll, RT/A for burst and LT/B for brake. Start pauses, X retries, Y opens the editor, D-pad up/down zooms, right changes course, and Back/R3 resets the camera.

Touch controls provide a steering stick, brake, burst, and roll buttons: hold to bank, double tap to spin. Sound starts enabled, unlocks on the first click or keypress, and synthesizes wind, engine hum, and gate chimes. Fullscreen is available at the top right.

## Grow

**Genome** in the toolbar opens a specimen view. Drag the background to orbit. Flight and the circuit timer stop while the editor is open.

The 67 alleles regulate a bounded developmental program:

| Module | Alleles | Effects |
| --- | ---: | --- |
| Axial patterning | 10 | Segment rhythm, body-axis duplication, curvature, polarity, symmetry |
| Terminal fields | 10 | Organizer duplication and migration, solid envelopes, crown ridges, shells and loops |
| Appendage grammar | 12 | Bud sites, recurrent branching, terminal repetition, membranes |
| Caudal grammar | 8 | Posterior buds, recursive bifurcation, curvature, seed organs |
| Sensory field | 10 | Allocation of nine eyes across grown surfaces, repulsion, stalks, filaments |
| Integument field | 9 | Interacting pigment fields, segment plates, spines, photophores |
| Growth & reflexes | 8 | Development timing, resource partition, compliance, respiration, movement |
| **Total** | **67** | |

Topology comes from thresholded induction fields and recursive production rules. Duplicated axes compete for a shared growth budget. Solid terminal tissue is one continuous parametric envelope: a central inhibitor divides dorsal growth into paired crown ridges. Two forward sensory sites anchor its feline reading. Other eyes sample the resulting surfaces with spatial inhibition; nine organs are conserved even when a short body cannot accommodate the requested migration. This is deterministic generative growth, not a trained recognition or shape-fitting model.

The three named founders—**Mantle**, **Spindle**, and **Corolla**—have one, three, and five body axes. **Random** samples the full allele range, including independent high-leverage fields for bulk, curvature, axis layout, solidity, and membrane retention. It does not perturb a single default creature. **Mutate** changes two to five alleles within one module. **Keep parent** stores an individual; **Cross** inherits complete regulatory modules from it and the current specimen. The generation and ancestry are shown in the editor.

**Atlas** compares eight fully grown specimens under the same view and lighting. Choose a card to load its exact genome, or use **More seeds** for another set. Thumbnails come from the production generator and are fitted by projected silhouette bounds; they do not rely on a separate model or hand-drawn previews. Creature geometry and thumbnail bounds are generated in a worker; outdated edits are discarded before they reach the scene. Thumbnail PNG encoding is asynchronous. The world renderer pauses behind the atlas, and a settled paused flight redraws only when its view changes.

**Regrow** replays axial growth, branch induction, and sensory differentiation. Scrub the development slider to inspect a stage. Slider tooltips describe each regulator's effects. Nine eyes are present at maturity; the sensory organs appear late during growth.

The current v2 genome and kept parent are stored locally. JSON export / import validates the complete 67-allele schema. Unedited founders from older generator revisions are regenerated from their seed; edited and bred individuals retain their alleles. Explicit imports retain all supplied alleles. Earlier v1 proportion-genomes have different semantics and are rejected on import; their separate browser storage is left intact.

## Atmosphere

The heightfield starts with finite mountain systems at two scales: major ranges and lower foothills, with closer range spacing and finer foothills extending into the basins. Each has an irregular connected crest graph, varying peaks and passes, asymmetric slopes, and branching side ridges descending into the lowlands. These mountain masses sit above a slower continental uplift field, leaving open country between the ranges. Downhill receivers collect contributing rainfall; stream-power incision cuts the drainage trees. Hydraulic erosion transports suspended sediment, and thermal relaxation settles steep slopes. Exposure-weighted, piecewise planar relief adds angular shoulders, folded crests, and smaller spurs to the actual heightfield while basin floors stay smoother. Low-angle lighting separates opposing faces. Surface colors remain untextured. Lighting samples a 16 m world-space normal map derived from the 8 m heightfield in the fragment shader, preserving surface shading across mesh detail levels. Cached 64 m terrain horizon and concavity probes are also sampled per pixel; the shader compares the horizon with each fragment's height to soften sunlight behind nearby ridges and shade rock foundations without an additional shadow-map render pass. Both maps stream in bounded 16 km wrapping textures.

The flight routes never carve the landscape. Arches and stone needles are separate collidable meshes fitted to the eroded ground. Elevation colors run from deep blue through teal and green to copper summits. Gate crossings send expanding pulses over the slopes. The sky has a horizon-to-zenith gradient, drifting cloud decks, sunlight scattering, and sparse upper-sky stars.

Erosion runs on a 40 m simulation grid. Each patch includes a halo wider than the full reach of its simulation, so independently generated patches agree exactly at their joins. Bicubic interpolation feeds the 8 m collision/render grid near the pilot. Every terrain detail level shares the same 8 m boundary vertices, and logarithmic depth preserves precision at high altitude.

Startup prepares the current reach first and immediately builds nearby terrain. Distant tiles and stone formations fill in within a frame budget after their height patches arrive, without running erosion on the rendering thread. Crossing into an unprepared reach defers its course setup; flight waits safely if local collision data has not arrived, and queued route/retry actions run when ready. A bounded cache shares exact 8 m Float32 samples between collision, geometry, and normals. The cubic sampler avoids temporary arrays.

The initial reaches are baked from the same generator into `assets/terrain/`. New areas are generated in a worker and cached locally. `npm run bake:terrain` rebuilds the starting-region data after changing the generator; bump `EROSION_REVISION` when changing its output.

Ground, organisms, arches, and rings use the analytic exponential-height integral from IQ’s [Better Fog](https://web.archive.org/web/20231021103649/https://iquilezles.org/articles/fog/). The density is `a * exp(-b * height)`. Its integral along the camera-to-surface ray controls a single fog blend. The implementation handles horizontal rays with the analytic limit and reverses descending segments for numerical stability. Fog color changes from cool blue to warm sunlight as the view aligns with the sun, using IQ’s eighth-power directional blend. The sky uses the same atmosphere and camera altitude.

Terrain, creature lighting, the sun disk, fog, and a small procedural lens flare share one sun direction. The flare has a short streak and faint colored ghosts. Terrain and stone formations occlude it; fog attenuates it, and it fades at the edge of the view. Light / Depth / Dense changes the height-density coefficient.

The world streams tiles around the pilot at four levels of detail, out to approximately 6.1 km on desktop and 4.6 km on mobile. It disposes distant geometry and spreads tile generation across frames. Distance thresholds have hysteresis, and detail changes use a brief complementary dither fade. Distant tiles are grouped into small spatial batches; each gate uses one draw. Nearby collision triangles remain unchanged. Reaches are spaced 7.2 km apart, with local flight lines and stone formations across a continuous eroded surface. There is no forced turnaround boundary. Discovering a reach updates the URL, so it can be bookmarked; `?reach=3,-2` opens a distant one. Near the pilot, flight clearance and ring placement use the exact triangles of the rendered heightfield.

## Validate

```sh
npm run check
npm test
npm run test:routes
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs npm run test:quality
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs npm run survey
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs npm run smoke
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs npm run test:world
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs npm run test:air
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs npm run test:startup
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs npm run test:collisions
npm run bench:heightfield
```

The local server serves compressed JavaScript, revalidates changed code with ETags, and caches terrain files by generator revision.

Run the server before the browser checks. Playwright and Chromium are required; `CHROMIUM_PATH` overrides `/usr/bin/chromium`. The smoke check exercises growth, inheritance, persistence, import/export, flight, both steering directions, Q capture, body-frame rolls and banked steering, double-tap spins, airbraking, atmosphere settings, and touch input. Captures and result JSON go to `artifacts/`.

The geometry checks cover extreme and seeded genomes, a 128-seed architecture and proportion range check, exact eye count, module inheritance, growth after world translation / rotation, screen-space steering, physical roll and spin completion at different frame rates, banked pitch steering, momentum, full vertical loops, removed climb inputs, burst regeneration, arch collision, distant reaches, and collision agreement with mesh raycasts. Browser checks also compare atlas silhouettes and exercise its modal controls.

`test:routes` steers the production flight integrator through all four routes and a distant reach, without setting pilot positions. `test:world` reads GPU pixels through both fog shader paths and compares them with independent numerical integration at multiple distances, altitudes, and view directions, checks route selection, flies four gates and an arch using keyboard events, and renders a distant reach.

Three.js 0.186.1 and its license are in `vendor/`. DM Sans and Space Mono are bundled under their SIL Open Font Licenses in that directory. The flying-creature premise was inspired by [Kitten Burst](https://jam2go.com/kitten-burst).

`test:air` checks rendered flare pixels, hillside occlusion, and looking away from the sun. `survey` captures the production terrain from overhead and from a high oblique angle with fog disabled, plus a ridge view with atmosphere enabled. Erosion checks cover sediment mass, checkerboard stability, and exact patch joins.

`test:startup` withholds distant terrain downloads until the loading screen has closed, then checks complete streaming and an unbaked reach with no synchronous erosion. `test:collisions` stages slow and fast contacts against a production stone arch, verifies the timeout overlay, rebound motion, continuing game clock, and disabled controls, and checks recovery and retry. `bench:heightfield` checks exact sampler equivalence at 300,308 coordinates and compares CPU time with the previous implementation.

`test:quality` checks paused rendering, batched flight draw calls, terrain transition coverage, worker cancellation, atlas rendering, and the effect of shadow/contact lighting on actual GPU pixels. The frame-work tests compare elapsed flight time and particle counts at 10, 15, 30, 60, and 144 FPS and verify worker geometry transfer and removal from spatial batches. Browser timings from software WebGL are not hardware GPU benchmarks.
