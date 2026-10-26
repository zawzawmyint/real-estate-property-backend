# Generated demo photography

These six images were generated with the built-in ImageGen tool on 2026-10-22 for fictional Avenor Properties demo inventory. They are not photographs of real available listings. Fifteen sample records deliberately reuse this small illustrative library; gallery images do not promise a consistent real address/layout. The public detail notice and sample descriptions explain this.

## Files and prompts

Common direction: one photorealistic landscape real-estate listing photograph, 4:3, architectural/editorial photography, natural textures, straight verticals, believable proportions, realistic light. Fictional Avenor demo property. No people, text, branding, watermarks, borders or collage.

- `photos/marina-apartment.webp`: Spacious contemporary Dubai marina apartment living room, ivory linen sofa, warm oak, floor-to-ceiling windows framing a fictional waterfront skyline and yachts. Morning sunlight, subtle maroon cushion, realistic residential scale.
- `photos/garden-villa.webp`: Contemporary Dubai family villa exterior, two stories with cream stone and warm timber, private garden and modest turquoise pool, mature palms, open sliding doors. Warm afternoon light, refined residential photography.
- `photos/downtown-penthouse.webp`: Refined high-rise Dubai penthouse dining/living space, sculptural cream sofa, travertine dining table, bronze accents, expansive city skyline in warm late-afternoon sun. Sophisticated but believable interior.
- `photos/courtyard-townhouse.webp`: Welcoming contemporary Dubai townhouse exterior, warm white stucco, timber front door, planted private courtyard, olive tree and bougainvillea, quiet pedestrian lane. Early morning soft sunlight, approachable family home.
- `photos/coastal-apartment.webp`: Sunlit modern coastal Dubai apartment living room, white walls, pale oak floors, cream sofa, blue-green accents, balcony overlooking a fictional beach and turquoise sea, sheer linen curtains. Realistic scale, tasteful attainable furnishings.
- `photos/serene-bedroom.webp`: Tranquil contemporary bedroom, king bed with textured ivory linen, upholstered headboard, walnut bedside tables, warm neutral rug, floor-to-ceiling window with planted terrace. Soft late-morning daylight.

All outputs are 1448×1086. Selected generated PNGs were converted to WebP at quality 85 for project storage. The seed revalidates and normalises them through the same decoder as property uploads. `src/modules/properties/demo-data.ts` owns the record-to-image mapping.

These are intentional source fixtures. Runtime copies belong under configured STORAGE_ROOT and remain ignored, as do SQLite databases. Never upload confidential material into this public image store.

## Local/demo seed

After configuring the backend and running migrations, execute `bun run demo:seed -- --confirm-demo`. The command refuses production and missing consent, adds only missing deterministic sample keys, preserves all existing real/demo edits and prints created/skipped totals. It has no delete/reset mode and never runs at server startup. No staff accounts are created.
