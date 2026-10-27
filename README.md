# Where2Live

Where should we live? Enter the places you go regularly — work, church, the gym, the shops, friends — with who goes, how often and how. Where2Live works out the total weekly travel time from every possible home across the area and shades the map in bands, so you can see where you'd spend the least time travelling. Change a value and the map updates instantly; shortlist rental listings to compare them exactly.

- Runs entirely in your browser. Your places never leave it, except as coordinates sent to the routing service.
- Driving, cycling and walking times come from [openrouteservice](https://openrouteservice.org) (free; you paste your own key from [account.heigit.org](https://account.heigit.org)). Public transport is planned.
- Try the demo without a key: it uses rough straight-line estimates.

## Develop

```sh
npm install
npm run dev       # http://localhost:5173
npm test          # unit tests
npm run build && npm run e2e   # end-to-end tests (Edge, headless)
```

Map data © OpenStreetMap contributors · Basemap © OpenFreeMap / OpenMapTiles · Routing by openrouteservice (HeiGIT).
