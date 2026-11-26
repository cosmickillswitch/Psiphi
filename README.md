# Psi Phi Studio (tablet)

A scientist's animation studio that combines **Animath** (Manim-style 2D: LaTeX maths, graphs, logic, nodes, geometry, stickers, drawing, values, camera, sound, Manim code export) with **Psi Phi Studio** (3D: proteins from the PDB, molecules, lipid bilayers, tight junctions, paper stacks), plus new anatomy and cell-biology models. Everything sits on one CapCut-style timeline.

## Layout (iPad / tablet)
- **Menu bar:** File (new blank canvas, demos, projects, export), Edit, **Insert** (every category, plus Molecule by name, Protein by PDB ID, Search PDB), View.
- **Preview** in the middle. Drag an object to move it. Drag empty space to orbit the 3D world, and pinch or scroll to move the 3D camera closer.
- **Right panel**, always open. With something selected it shows Edit · Animate · Effects · Style · Keys · Rig, plus quick actions. With nothing selected it shows Layers · Scene · Camera · Values · Sound · Library · Code.
- **Timeline**, then the **tool dock**: Draw, Sketch, Text, Shapes, Graphs, Logic, Physics, Maths, Nodes, Geometry, 3D, Stickers, Media, Library, Values, Camera, Sounds, Scene, Code, Molecules, PDBs, Anatomy, Cell biology. Categories open a tray of things to add at the playhead.

## 3D objects
3D things are ordinary clips. They get Animath's entrance and exit animations (Create draws a protein along its chain or grows a membrane from the middle; Fade, Grow, Pop, Spin and the rest work too), keyframed position, scale and rotation, and parenting. The **3D** section of the Edit tab has their own keyable values, each with a ◇ key button, plus one-tap moves:
- **Protein:** cartoon, atoms, atom size, sticks, ligands. Includes Cartoon → atoms.
- **Molecule:** atom size, sticks. Find by name (PubChem 3D) or SMILES; about 50 common molecules also work offline.
- **Membrane:** curvature (flat → vesicle), jiggle, pore. **Tight junction:** gap, strands, leak.
- **Paper stack (PDF or image):** spread, fan, focus page, lift.
- **Bio models:** BBB capillary (cut-away), capillary, neuron (fire a signal), red blood cell, cell, mitochondrion, DNA (unzip), virus.
- **3D shapes:** sphere, cube, torus, knot and more, in glossy, matte, metal, glass, toon or wireframe.
- Every 3D object also has **Spin**, **Tilt** and **Depth**. The **Camera** tab has a keyable 3D camera (orbit, tilt, distance, lens) with Turntable and Dolly moves.

3D always draws behind the 2D layer, in one shared 3D space, so a protein can sit inside a membrane. Objects are fitted to a similar size unless you tick **True size** (1 unit = 10 Å).

## Sculpting and rigging (ClayForm)
3D → **Sculpt a clay head**, **Sculpt from scratch** or **Rigged clay character**, or a **puppet**: biped, quadruped, hexapod, octopod (spider) or octopod (octopus). Each puppet comes rigged and skinned with a looping two-second walk or swim cycle (also in Insert → Sculpt, and in ClayForm’s ⋯ menu) opens ClayForm full screen. It has sculpt brushes, objects, Rig (bones and skin weights), Pose, Stage (puppeteering with a controller or your face), shape keys and a timeline. **Use in scene** brings the result back as a clip that keeps its rig, shape keys and animation. The animation plays from the start of the clip, and you can set its speed and looping. **Edit in ClayForm** on a sculpt clip reopens the same ClayForm project, and **Update in scene** swaps the new version in.

### One app, not two
`clayform.html` is the final ClayForm (version 7: the Professor, the view gizmo, axis lock and face puppeteering), built into Psi Phi Studio. It opens inside Psi Phi Studio, says when it’s ready, and hands the sculpt back as a GLB with its rig, shape keys and animation. Psi Phi Studio keeps asking until ClayForm answers, so a slow first load can’t leave **Use in scene** stuck. ClayForm has no offline worker of its own here: Psi Phi Studio’s worker caches it, and an old ClayForm worker left over from an earlier install is removed on start. You can still open `clayform.html` on its own, and it shares the same projects.

Starters (Insert → Sculpt, the 3D tray, or ClayForm’s ⋯ menu): clay head, sculpt from scratch, rigged clay character, the Professor, and the biped, quadruped, hexapod, spider and octopus puppets.

## Labels that follow 3D
Any 2D object (text, maths, arrows, stickers, diagrams) can be **pinned to a 3D object or residue** from the **Pin to 3D** section of its Edit tab. It follows the object as the 3D camera moves, and its own position becomes an offset. An optional **leader line** grows in with the entrance animation. 3D objects have a **＋ Label pinned to it** button, and proteins and molecules also have **＋ Label a residue…**: tap a residue on the preview and the label takes its name.

## Transporters and channels
In Cell biology: **GLUT1**, **P-glycoprotein**, **aquaporin** and a **K⁺ ion channel**. Each carries its cargo across: glucose by alternating access, a drug pumped out with ATP, water in single file, and ions through an open gate. Speed, cargo and gate are all keyable. **Seat it in a membrane** puts the protein and a bilayer at the same true scale and opens a pore for it.

## Diffusion and data
- **Physics → Diffusion:** particles on a random walk, starting as a gradient, a drop or spread out, with an optional membrane barrier of adjustable permeability. Shows left/right counts and a live concentration profile.
- **Graphs → charts from CSV:** bar, line, scatter and **forest plots** (meta-analysis style, with a log scale, a line of no effect and a pooled diamond). Paste data or import a CSV file. Charts draw on with Create like any Manim object.

## Diagrams (2D, drawable with Create)
Neurovascular unit, capillary, brain, neuron, red blood cell, animal cell, mitochondrion, synapse, each with optional labels. **Hand over to 3D** crossfades a diagram into its matching 3D model (for example, the neurovascular unit becomes the BBB capillary).

Sculpts and 3D shapes can use a **clay** or **glazed clay** look (matcaps, as in ClayForm).

## Files
- `core.js`: Animath engine, with a small hook that draws the 3D layer.
- `sci2d.js`: diffusion and CSV charts (2D Animath types).
- `bio3d.js`: the 3D layer (three.js r128): structures, molecules, membranes, junctions, papers, bio models, 2D diagrams, PubChem and RCSB fetching.
- `editor.js`: the editor (Animath's, extended with the menu bar, dock trays, tablet panel, 3D inspector and gestures).
- `export.js`: Manim code export. 3D objects become placeholders.
- `clayform.html`: the whole ClayForm sculpt, rig and animate app in one file, opened by Studio in a full-screen frame.
- `app.css`, `index.html`, the five `lm-*.woff` fonts, `manifest.webmanifest`, `sw.js` (bump `VERSION` after changes).

There are no folders: every file sits at the top level, so uploading from an iPad (which drops folders) works.

## Notes
- Fetching from PubChem and the RCSB needs the internet. It works on GitHub Pages but not inside the Claude preview.
- Projects are stored in this browser, and structure files, PDFs and images in IndexedDB. File → Projects → Save project file carries them with it.
- Storage is separate from Animath's, so both apps can live on the same GitHub Pages site.

## The Add tray

The first button in the dock, **＋ Add**, gathers the import tools in one place (they're also under Insert → Add):

- **Record voice…** records from the microphone, starting at the playhead, and puts it on the sound track.
- **3D model (OBJ / GLB)…** brings in models from Blender. GLB (File → Export → glTF 2.0, "glTF Binary") keeps materials, textures, rigs and animation; OBJ keeps the shape only. `.blend` files can't be opened directly.
- **PDB file / PDB by ID / Search the PDB**, **Molecule by name / from SMILES / SDF or MOL file**.
- **Atom…** picks an element from a periodic table; styles are Bohr model, 3D orbits, electron cloud and CG sphere, and any atom can be made an ion.
- **Periodic table** (2D), in five looks (classic, solid, by block, line, neon), with highlights such as `Na, Cl`, `halogens`, `group 1`, `period 3` or `d-block`.
- **PDF / image / document…** turns PDFs, images, Word (.docx), text and Markdown into a stack of pages. Several images or documents together become one PDF.

Molecules have styles too: CG (glossy, two-tone bonds, outlined), ball and stick, space-filling, sticks and toon.

You can also **drag files onto the app**: models, structures, molecules, PDFs, images, documents and sound go to the right place.

`elements.js` holds the data for all 118 elements (names, atomic weights, families, positions and electron shells).

## Tabula and 8-Bit studios

*Renamed:* Biostage is now **Psi Phi Studio**, Clayframe is **ClayForm**, Artwork is **Tabula** and Pixel Art is **8-Bit**. The files are `clayform.html`, `tabula.html` and `8bit.html`; projects made under the old names still open.

Like ClayForm, these open full-screen from **Insert → Tabula** / **Insert → 8-Bit** (and from the ＋ Add tray). **✓ Use in scene** brings the result back as an artwork object you can move, scale, keyframe and style like anything else. Its panel adds **Animate**, **Frames per second**, **Speed**, **Playback** (loop, ping-pong, once) and **Frame to show**. **Edit in Tabula / 8-Bit** reopens the original.

- `tabula.html` is a painting studio in the spirit of Procreate. It has 17 brushes with Pencil pressure and tilt (pencils, inks, paints, airbrushes, watercolour, charcoal, pastel, calligraphy, texture), plus smudge and eraser using any brush. Layers support blend modes, opacity, alpha lock, clipping masks and background layers. Other features:
  - QuickShape: hold at the end of a stroke to snap it to a shape.
  - Symmetry and grid guides, transform, hue/saturation/brightness and blur.
  - ColorDrop: drag the colour circle onto the canvas to fill.
  - Gestures: two-finger tap undoes, three-finger tap redoes, pinch zooms and rotates, touch-and-hold picks a colour, four-finger tap hides the interface.
  - Frame-by-frame animation with onion skin. Background layers stay the same on every frame, and "leave the background out" makes the asset transparent.
- `8bit.html` is a pixel editor in the spirit of Pixquare. Tools: pencil (pixel-perfect), eraser, fill, line, rectangle, ellipse, picker, select/move, dither and shade. It also has mirror drawing, palettes (PICO-8, Sweetie 16, Endesga 32, Game Boy and more), layers, animation frames with onion skin, and PNG, sprite sheet and GIF export.

Both keep their own projects on the device (IndexedDB) and also work on their own if you open the file directly.

## Logos and Calsheet

**Insert → Logos** is a document and script writer: styles (title, headings, quote, code), fonts including Latin Modern, sizes, bold, italic, underline, colours, highlight, alignment, line spacing, bullet, numbered and check lists, tables, pictures, links, find and replace, word count with reading time, and import or export (.docx, .txt, .md, .html, PDF). **Script mode** formats a screenplay: Tab changes the line type, and Return moves to the next natural one.

**Insert → Calsheet** is a spreadsheet: A1 formulas (tap cells to point at them), around 100 functions (SUM, AVERAGE, IF, VLOOKUP, XLOOKUP, COUNTIF, STDEV, SEM, T.TEST, CORREL, SLOPE, NORM.DIST, text and date functions), number formats, fill, sort, insert and delete rows and columns, several sheets, CSV and Excel import, CSV export, and live column, line, scatter, pie and donut charts.

**✓ Use in scene** in each studio offers:
- Logos: the selection as text, the selection as a picture (it keeps the look), a table, or the whole document beside the stage.
- Calsheet: the selected cells as a table, as an animated chart, or the whole sheet beside the stage.

Objects remember where they came from. **Edit in Logos / Calsheet** reopens the original and updates the object.

**The reader** shows a document or sheet in a floating panel beside the stage, so you can read a script while recording. Drag its top bar to move it and its corner to resize it. A− and A+ change the text size. Choose **Scroll by hand**, **Auto-scroll** (with a speed slider) or **Follow the timeline** (the page keeps pace with the playhead). In ⚙ you can make it start with ▶ Play and 🎙 Record. While the reader is open, the voice recorder stays small, and it can play the scene as you speak. The reader never appears in exported videos.

## Final Stage (video editor)

**File → Final Stage**, or **🎬 Send to Final Stage** after exporting a video from Psi Phi Studio or ClayForm. It is a CapCut-style editor:
- **Tracks:** a magnetic main track, two overlay tracks (picture-in-picture, with blend modes), a text track and two sound tracks.
- **Editing:** split, trim with the yellow handles, copy, delete, freeze frame, speed (0.25–4×), volume and fades.
- **Animation:** keyframes (◇) for position, size, angle and opacity.
- **Transitions:** cross-fade, dip to black or white, slide, push, wipe, circle and zoom.
- **Looks and effects:** brightness, contrast, saturation, warmth, tint, vignette, blur and grain.
- **Titles:** presets with pop, rise, slide, wipe and typewriter animations.
- **Export:** 720p to 4K, at 24, 25, 30 or 60 fps.

## Smooth exports

Videos are now rendered frame by frame with WebCodecs and written as MP4 (H.264 with AAC or Opus sound), so slow scenes no longer drop or skip frames. Older browsers fall back to real-time recording. The encoder is `videnc.js`.

## ClayForm additions

- **Model mode:** a low-poly cage of quads, smoothed with Catmull–Clark subdivision. Pick points, edges or faces, then Extrude, Inset, Loop cut, Merge or Delete. Mirror X is available, and Smooth ± changes the subdivision level.
- **Quads:** the wireframe and OBJ export use quads.
- **Puppet:** a wooden mannequin built from rigid pieces with ball joints. Sliders set its height, build and proportions, and there are presets.
- **Joints:** a Tight ↔ Soft setting for how far a bend spreads into neighbouring parts. Automatic weights now account for each bone's thickness and keep chest skin on the chest.
- **Brush Falloff slider:** sets how gently a brush fades out at its edge.

### Topology tools (ClayForm → Sculpt)
- **◇ Subdivision:** a non-destructive Subdivision Surface modifier (Catmull–Clark), levels 1–4. You sculpt, rig and pose the mesh underneath, and exports and Use in scene get the smooth version. **Apply** makes it the real mesh.
- **◈ Remesh** opens Remesh & topology:
  - Voxel remesh (an even grid of quads)
  - Quad remesh (a target face count)
  - Decimate (quadric edge collapse to a target triangle count)
  - Fill holes (patches made of quad rings)
- **Rebuilding the mesh** with Subdivide or any of the remesh tools carries skin weights, paint and shapes across from the nearest old points, so painted weights and a Puppet's solid pieces survive.

### Ready-made models, textures, skies and space (ClayForm → ＋ Add)
- **Buildings:** house, shed, tower block, brick wall, stone wall, fence.
- **Ground & roads:** grass, wooden, tiled and marble floors, road, zebra crossing, pavement with kerb, cobbled path, pond.
- **Furniture:** table, chair, sofa, bed, bookshelf, desk, floor lamp, rug, park bench, street lamp, bin, pot plant.
- **Nature:** tree, pine, bush, rock, flowers.
- **Space:** the Sun, the eight planets, the Moon and Pluto, plus a whole Solar System line-up with squeezed sizes.
- **Sky:** clear day, overcast, sunset, dawn, night or space, behind the scene and in exported videos.
- **Look → Texture:** gives any shape one of these procedural textures:
  - building and ground surfaces: brick, planks, wood grain, tiles, paving, cobbles, roof tiles, asphalt
  - natural surfaces: grass, leaves, bark, water
  - fabric and marble
  - the planet surfaces
  - Pattern size and second-colour controls

  Textures are drawn by ClayForm's renderer, so they show in ClayForm and in its video exports. When a model goes to Psi Phi Studio through Use in scene, it keeps its colours but not its textures.

### Tabula brushes
- **Brushes:** 41 brushes in 9 sets, with smooth tips and paper, canvas or rough textures fixed to the page.
- **Paint behaviour:** wet paints pick up and carry colour. Foliage, grass, clouds and stars vary their colour.
- **Blend tool (💧, key N):** Soft Blender, Paper Stump and Water Blend soften and mix colours without dragging them.
